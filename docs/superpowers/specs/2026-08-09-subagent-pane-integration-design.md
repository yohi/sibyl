# 設計書: サブエージェント自動ペイン分割（sibyl）

- **対象プロダクト**: `@yohi/sibyl`（OpenCode マルチペイン統合コンソールプラグイン）
- **ステータス**: 設計確定（実装計画フェーズへ移行可 / 未実装）
- **関連ドキュメント**: [SPEC.md](../../SPEC.md), [REQUIREMENTS.md](../../REQUIREMENTS.md), [architecture.md](../../architecture.md), [akane 設計書](../../../../oss/akane/docs/subagent-display-and-termination-design.md)
- **依存取得手順**: 本リポジトリでは `oss/` は `.gitignore` で追跡対象外のため、クリーンチェックアウトでは `akane` / `opentui` / `oh-my-openagent` が存在しない。セットアップ・CI では以下で取得すること。

  ```bash
  mkdir -p oss
  git clone https://github.com/yohi/akane.git oss/akane
  git clone https://github.com/anomalyco/opentui.git oss/opentui
  git clone https://github.com/code-yeongyu/oh-my-openagent.git oss/oh-my-openagent
  ```
- **前提バージョン**: `@opencode-ai/plugin@^1.18.8`（`package.json` の `peerDependencies` と整合）, `opentui`（vendored in `oss/opentui`）, Bun (biome/test)

---

## 1. 概要

oh-my-openagent などの OpenCode プラグインが spawn するサブエージェントセッションを、**Tmux に依存せず**、Sibyl 自身の OpenTUI ベースのペイン分割機能を用いて自動的に表示・管理する機能を追加する。

これにより、以下の課題を解決する。

1.  **Tmux 依存の排除**: 現在の oh-my-openagent はサブエージェント表示のために tmux を要求するが、これを排除する。
2.  **軽量な表示**: `akane` が計画している「`opencode attach --mini` による即時表示」を、`sibyl` の仮想端末ペインとして実現する。
3.  **自動クリーンアップ**: サブエージェントのライフサイクル（生成・アイドル・エラー・削除）に応じて、ペインを自動的に開閉する。

---

## 2. 確定した設計判断

| # | 判断 | 内容 | 理由 |
|---|---|---|---|
| D-1 | **連携方式** | oh-my-openagent を変更せず、OpenCode の `session.created` イベントをフックする。 | 疎結合を保ち、既存プラグインへの影響を最小化するため。 |
| D-2 | **表示方式** | Phase 1 では `opencode attach <serverUrl> --session <id> --dir <directory> --mini` を仮想端末ペインで実行する。 | akane の設計と整合し、まずは実績のある方法で表示を実現するため。将来的には `xterm-headless` 等でのセルマトリクス表示に移行する可能性がある。 |
| D-3 | **設定管理** | akane 設定 > 環境変数 > sibyl 設定。**`enabled` / `maxPanes` は項目単位で上位ソースの定義値を採用し、`subagentDisplay` ブロック内の他のキーも同じ優先順位で個別解決する（ブロック単位の置換は行わない）**。 | 単独動作と連携動作の両立のため。 |
| D-4 | **ペイン数制限** | 上限 4、超過時は最も古いものから evict（akane 準拠）。境界値の扱いは FR-2.1 を参照。 | akane の設計と挙動を揃え、ユーザー体験を統一するため。 |
| D-5 | **終了時処理** | `session.idle` 受信時、ペインを即座に閉じる。セッション自体の削除は行わない。 | 削除責務は akane にあるため。 |
| D-6 | **エラー時処理** | `session.error` 受信時、`sessionID` が特定できればペインを閉じる。`sessionID` が無い場合はペインを閉じずログのみ記録する。`session.deleted` 時は cleanup のみ。 | akane 準拠 + SDK（`EventSessionError.sessionID?: string`）の optional 性に対応するため。 |
| D-7 | **イベント購読方式** | OpenCode Server API (SSE) を直接購読する。切断・購読開始前のイベント欠落に備え、起動時・再接続時にアクティブセッションを pull して再同期する（FR-4 参照）。 | akane と同様のレイヤーで確実にイベントを取得するため。 |
| D-8 | **設定ソース** | `PluginInput` から `serverUrl`, `directory` を取得し、環境変数 `OPENCODE_SERVER_URL`, `OPENCODE_PROJECT_DIR` で上書き可能（**環境変数 > akane 設定 > sibyl 設定。この優先順位は `serverUrl` / `directory` を含む全設定項目に同一ルールで適用する**）。 | TUI プラグインのコンテキストを最大限活用するため。 |
| D-9 | **認証伝播** | `OPENCODE_SERVER_PASSWORD` が設定されている場合、SSE 購読には `Authorization: Basic ...` ヘッダーを付与し、`opencode attach` への資格情報の受け渡しは子プロセスの環境変数経由（`OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD`）とし、`-u` / `-p` コマンドライン引数には載せない。認証情報はいかなるログにも出力しない。 | CLI 引数は `ps` 等で観測可能なため、環境変数伝播で漏洩面を減らすため。 |

---

## 3. アーキテクチャ

### 3.1 システム構成

```text
OpenCode Server
    │
    ├─ SSE Event Stream (session.created, session.idle, session.error, session.deleted)
    │   ※Authorization: Basic ヘッダー付与（OPENCODE_SERVER_PASSWORD 設定時。D-9 参照）
    │
    ▼
Sibyl Plugin (Server)
    │ (in-process)
    ▼
Sibyl Plugin (TUI)
    │
    ├─ SubagentLifecycleManager (新規): イベントを state machine で処理
    │
    ├─ SubagentPaneAdapter (新規): PaneBackend を介して OpenCode ペインを操作
    │
    ├─ OpenTuiPaneBackend (デフォルト): Tmux 非依存。opencode attach の PTY 起動とペイン分割・操作を実行
    │
    └─ TmuxAdapter (外部アダプター・参考実装): 既存 tmux 環境向け後方互換レイヤー（本 PR では変更しない）
```

### 3.2 コンポーネント

| コンポーネント | 責務 | 新規/変更 |
|---|---|---|
| `SubagentLifecycleManager` | サブエージェントのライフサイクルを管理し、ペインの開閉を指示する状態機械。起動・再接続時の `session.list` による再同期と、TUI 終了時の SSE 購読解除も担う。 | 新規 |
| `SubagentPaneAdapter` | `PaneBackend` I/F に従い、`opencode attach` を実行する PTY プロセスをペインに割り当てる。ペイン作成・削除は冪等とする。 | 新規 |
| `OpenTuiPaneBackend` | Tmux に依存しないデフォルトのペインバックエンド。`opencode attach` PTY 起動と OpenTUI ペイン操作を担う。 | 新規 |
| `ConfigResolver` | `sibyl.*` と `akane.experimental.watchdog.subagentDisplay.*` の設定を、環境変数 > akane > sibyl の優先順位で項目単位に解決する。`maxPanes` の検証（FR-2.1）も担う。 | 新規 |
| `server.ts` | 新しいコマンド（例: `sibyl.toggleSubagentDisplay`）を登録する。 | 変更 |
| `tui.tsx` | `SubagentLifecycleManager` を初期化し、イベントを購読する。終了時に購読を解除する。 | 変更 |

---

## 4. 機能要件

### FR-1: サブエージェントの自動表示

- **FR-1.1**: OpenCode の `session.created` イベントで `parentID` を持つセッションを検出した場合、新しい OpenTUI ペインを分割して `opencode attach <serverUrl> --session <id> --dir <directory> --mini` を実行する。
- **FR-1.2**: この機能は設定により有効/無効を切り替えられる（デフォルトは無効）。
- **FR-1.3**: 新規ペインは水平分割（horizontal split）として作成される。
- **FR-1.4**: `opencode attach` の実行に必要な `serverUrl`（`PluginInput.serverUrl` または `OPENCODE_SERVER_URL`）と `dir`（`PluginInput.directory` または `OPENCODE_PROJECT_DIR`）は、D-8 の優先順位で取得する。
    - **引数順序**: `opencode attach <serverUrl> --session <id> --dir <directory> --mini`。`<serverUrl>` は必須の positional 引数として先頭に置き、`--dir <directory>` を必須で渡す（実 CLI `attach.ts` は `attach <url>` を `demandOption: true` で要求する）。**argv テストはこの正確な順序と値を assert する**。
    - **入力検証**: `serverUrl` は `http://` / `https://` スキームに限定する。`sessionID` は SDK `Session.id` 相当の形式（連番・英数字 ID、空文字・空白・シェルメタ文字を含まない）を検証し、無効値は attach 起動前に拒否する。
    - **起動方式**: シェル非経由の spawn スタイル argv 配列で起動する（`shell: false` 相当。`Bun.spawn(argv, ...)` / `node-pty.spawn(cmd, args, ...)`）。シェル経由の文字列結合は行わず、インジェクションを構造的に排除する。
    - **認証**: `OPENCODE_SERVER_PASSWORD` 設定時、資格情報は子プロセスの **環境変数**（`OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD`）として引き継ぎ、`-u` / `-p` 引数には値を含めない（D-9 参照）。

### FR-2: ペイン数の管理

- **FR-2.1**: 表示されるサブエージェントペインの数は、設定値 `subagentDisplay.maxPanes`（デフォルト: 4）を超えない。
    - **有効範囲**: 1〜8 の整数。
    - **無効値の挙動**:
        - `0`: 機能を無効とみなし、起動時に既存のサブエージェントペインをすべて閉じ、以後新規ペインを開かない（evict ループには入らない）。
        - 負数・小数・`NaN`・整数でない値: 設定の読み込み時にバリデーションエラーとして拒否し、デフォルト値 4 にはフォールバックしない（誤設定の黙殺を防ぐ）。
    - **テスト**: 0 / -1 / 2.5 / NaN / 1 / 8 の各ケースでバリデーションと evict 境界の振る舞いを Unit テストでカバーする。
- **FR-2.2**: 上限に達した状態で新しいサブエージェントセッションが作成された場合、最も古い（**`info.time.created`** が最も早い。SDK `@opencode-ai/plugin@^1.18.8` の `Session.time.created` に対応）サブエージェントペインを自動的に閉じる（evict）。

### FR-3: ペインの自動クリーンアップ

- **FR-3.1**: サブエージェントセッションが `session.idle` イベント（`event.properties.sessionID`）を発行した場合、対応するペインを閉じる。
- **FR-3.2**: サブエージェントセッションが `session.error` イベント（`event.properties.sessionID`）を発行した場合、対応するペインを閉じる。**`sessionID` が存在しない場合はペインを閉じず、エラー内容のみログに記録する**（SDK `EventSessionError.sessionID?: string`）。
- **FR-3.3**: サブエージェントセッションが `session.deleted` イベント（`event.properties.info.id`）を発行した場合、対応するペインが閉じられていなければ閉じる。

### FR-4: SSE 再接続と状態再同期

- **FR-4.1**: SSE 接続の切断、および購読開始前に発生したイベントの欠落に備え、**起動時および再接続時**に `session.list` 系の SDK API でアクティブなセッション一覧を pull し、`sessionID` 単位で管理状態（開いているペイン集合）を再同期する。
- **FR-4.2**: 再同期の結果、管理下にないセッションのペインは新規作成し、逆にサーバ側に存在しないセッションの古いペインは削除する。
- **FR-4.3**: ペインの作成・削除は冪等に実装し、重複イベント（再接続直後の replay/pull との重複を含む）を受けても状態が破壊されないようにする。
- **FR-4.4**: TUI 終了時には SSE 購読を必ず解除し、残留プロセス（`opencode attach` PTY）に安全な終了シグナルを送って孤児ペインを残さない。

---

## 5. 非機能要件

- **堅牢性**: `opencode attach` や SSE の接続に失敗しても、プラグイン本体がクラッシュしないこと。エラーはログに記録する（ただし認証情報は除く。D-9 参照）。
- **パフォーマンス**: 同時に複数のサブエージェントが起動しても、UI の応答性が損なわれないこと（ペイン分割・削除が迅速であること）。
- **セキュリティ**:
    - `opencode` CLI の起動は **シェルを介さない spawn スタイルの argv 配列**とし（`shell: false` 相当）、シェル解釈を構造的に排除する。
    - `serverUrl` のスキーム（`http`/`https` のみ）と `sessionID` の形式を検証し、無効値は起動前に拒否する。
    - **認証情報（`OPENCODE_SERVER_PASSWORD` 等）はいかなるログレベルでも出力しない**。Unit テストでロガーの呼び出し引数に資格情報が含まれないことを assert する。

---

## 6. 設定スキーマ

### 6.1 設定構造

```typescript
// opencode.jsonc の "sibyl" または "akane.experimental.watchdog" の下にネストされる想定
interface SibylSubagentConfig {
  subagentDisplay: {
    enabled: boolean;   // default: false
    maxPanes: number;   // default: 4（有効範囲 1〜8、検証ルールは FR-2.1）
  };
}
```

### 6.2 設定解決の優先順位

`sibyl` プラグインが読み込まれた際、以下の優先順位で設定を解決する（D-3 / D-8 と同一のルール）。

1. **環境変数**（例: `SIBYL_SUBAGENT_MAX_PANES`, `OPENCODE_SERVER_URL`, `OPENCODE_PROJECT_DIR`）
2. **akane の設定**（`akane.experimental.watchdog.subagentDisplay`）
3. **sibyl の設定**（`sibyl.subagentDisplay`）

- **項目単位の解決**: `enabled` と `maxPanes` はそれぞれ独立に、最も優先度の高いソースで **定義されている値** を採用する（ブロック単位の置換ではなく、フィールド単位のマージ）。上位ソースで未定義の項目のみ下位ソースの値が使われる。
- **横断適用**: この優先順位は `subagentDisplay.*` に限らず、`serverUrl` / `directory` を含むすべての設定項目に同一ルールで適用する。

---

## 7. イベントフロー

1. **初期化**: `tui.tsx` が `SubagentLifecycleManager` を初期化。`ConfigResolver` で設定を読み込み、有効であればイベント購読を開始する。
    - 起動時に `session.list` で既存セッションを pull し、状態を再同期する（FR-4）。
2. **検出**: OpenCode から `session.created` イベントが届く。
    - `event.properties.info.parentID` があれば、`SubagentLifecycleManager` に `create` を指示（セッション ID は `event.properties.info.id`、タイムスタンプは `event.properties.info.time.created`）。
3. **作成**: `SubagentLifecycleManager` が `SubagentPaneAdapter` に `openChildSession` を要求。
    - `SubagentPaneAdapter` は `PaneBackend`（デフォルト: `OpenTuiPaneBackend`）に新しいペインを分割させ、`opencode attach ...` を実行する PTY プロセスを割り当てる。
    - ペイン数が上限を超えた場合、最も古いペインを閉じるコマンドを `SubagentPaneAdapter` に要求する。
    - セッション ID での重複起動は冪等に無視する（FR-4.3）。
4. **アイドル**: OpenCode から `session.idle` イベントが届く。
    - `SubagentLifecycleManager` が `SubagentPaneAdapter` に `closeChildSession` を要求。
    - `SubagentPaneAdapter` が対応するペインを閉じる。
5. **エラー/削除**: `session.error` または `session.deleted` が届いた場合も同様にペインを閉じる（`session.error` で `sessionID` が無い場合はログのみ）。
6. **終了**: TUI 終了時に購読解除と残留 PTY の終了を行う（FR-4.4）。

---

## 8. テスト戦略

- **Unit テスト**:
    - `SubagentLifecycleManager`: 各種イベントに対する状態遷移と、`SubagentPaneAdapter` への指示が正しく行われるか。接続ギャップ後の `session.list` による再同期（不要ペインの削除・欠落ペインの作成）と冪等性（重複イベント）を含む。
    - `SubagentPaneAdapter`: `opencode attach` のコマンドライン引数が `attach <serverUrl> --session <id> --dir <directory> --mini` の順序・値で正しく生成されるか。shell 非経由の argv 生成、URL スキーム / sessionID 検証、認証情報が argv に載らないことも assert する。
    - `ConfigResolver`: 設定の優先順位（環境変数 > akane > sibyl）が項目単位で正しく解決されるか。`maxPanes` の 0 / 負数 / 小数 / NaN / 境界値 1・8 の検証挙動をカバーする。
    - **ロギング**: いかなるログ呼び出しにも `OPENCODE_SERVER_PASSWORD` の値が含まれないことを assert する。
- **Smoke テスト**:
    - OpenCode を起動し、sibyl プラグインをロードする。
    - `oh-my-openagent` などでサブエージェントを spawn する。
    - Sibyl の TUI に新しいペインが自動的に作成され、`opencode attach --mini` の TUI が表示されることを目視で確認する。
    - サブエージェントが完了（idle）したときに、ペインが自動的に閉じることを確認する。
    - TUI を再起動し、起動時の再同期で既存サブエージェントペインが復元されることを確認する。

---

## 9. 実装フェーズ

1. **Phase 1**: 設計書確定 (本タスク)
2. **Phase 2**: 実装計画作成 (`writing-plans` スキル)
3. **Phase 3**: 実装
4. **Phase 4**: テストとレビュー
