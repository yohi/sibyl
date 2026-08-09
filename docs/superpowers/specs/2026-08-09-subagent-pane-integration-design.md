# 設計書: サブエージェント自動ペイン分割（sibyl）

- **対象プロダクト**: `@yohi/sibyl`（OpenCode マルチペイン統合コンソールプラグイン）
- **ステータス**: 設計確定（実装計画フェーズへ移行可 / 未実装）
- **関連ドキュメント**: [SPEC.md](../../SPEC.md), [REQUIREMENTS.md](../../REQUIREMENTS.md), [architecture.md](../../architecture.md), [akane 設計書](../../../../oss/akane/docs/subagent-display-and-termination-design.md)
- **前提バージョン**: `@opencode-ai/plugin@^1.11.2`, `opentui`（vendored in `oss/opentui`）, Bun (biome/test)

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
| D-2 | **表示方式** | Phase 1 では `opencode attach --session <id> --mini` を仮想端末ペインで実行する。 | akane の設計と整合し、まずは実績のある方法で表示を実現するため。将来的には `xterm-headless` 等でのセルマトリクス表示に移行する可能性がある。 |
| D-3 | **設定管理** | デフォルトは Sibyl 独自設定を使用し、akane の設定が存在する場合はそちらを優先する。 | 単独動作と連携動作の両立のため。 |
| D-4 | **ペイン数制限** | 上限 4、超過時は最も古いものから evict（akane 準拠）。 | akane の設計と挙動を揃え、ユーザー体験を統一するため。 |
| D-5 | **終了時処理** | `session.idle` 受信時、ペインを即座に閉じる。セッション自体の削除は行わない。 | 削除責務は akane にあるため。 |
| D-6 | **エラー時処理** | `session.error` 受信時、ペインを閉じる。`session.deleted` 時は cleanup のみ。 | akane 準拠。 |
| D-7 | **イベント購読方式** | OpenCode Server API (SSE) を直接購読する。 | akane と同様のレイヤーで確実にイベントを取得するため。 |
| D-8 | **設定ソース** | `PluginInput` から `serverUrl`, `directory` を取得。環境変数 `OPENCODE_SERVER_URL`, `OPENCODE_PROJECT_DIR` で上書き可能。 | TUI プラグインのコンテキストを最大限活用するため。 |

---

## 3. アーキテクチャ

### 3.1 システム構成

```
OpenCode Server
    │
    ├─ SSE Event Stream (session.created, session.idle, session.error, session.deleted)
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
    └─ TmuxPaneBackend (既存): 実際のペイン操作（this PRでは触らない）
```

### 3.2 コンポーネント

| コンポーネント | 責務 | 新規/変更 |
|---|---|---|
| `SubagentLifecycleManager` | サブエージェントのライフサイクルを管理し、ペインの開閉を指示する状態機械。 | 新規 |
| `SubagentPaneAdapter` | `PaneBackend` I/F に従い、`opencode attach` を実行する PTY プロセスをペインに割り当てる。 | 新規 |
| `ConfigResolver` | `sibyl.*` と `akane.experimental.watchdog.subagentDisplay.*` の設定を解決する。 | 新規 |
| `server.ts` | 新しいコマンド（例: `sibyl.toggleSubagentDisplay`）を登録する。 | 変更 |
| `tui.tsx` | `SubagentLifecycleManager` を初期化し、イベントを購読する。 | 変更 |

---

## 4. 機能要件

### FR-1: サブエージェントの自動表示

- **FR-1.1**: OpenCode の `session.created` イベントで `parentID` を持つセッションを検出した場合、新しい OpenTUI ペインを分割して `opencode attach --session <id> --mini` を実行する。
- **FR-1.2**: この機能は設定により有効/無効を切り替えられる（デフォルトは無効）。
- **FR-1.3**: 新規ペインは水平分割（horizontal split）として作成される。
- **FR-1.4**: `opencode attach` の実行に必要な `serverUrl` と `dir` は、`PluginInput` または環境変数から取得する。

### FR-2: ペイン数の管理

- **FR-2.1**: 表示されるサブエージェントペインの数は、設定値 `subagentDisplay.maxPanes`（デフォルト: 4）を超えない。
- **FR-2.2**: 上限に達した状態で新しいサブエージェントセッションが作成された場合、最も古い（`createdAt` が最も早い）サブエージェントペインを自動的に閉じる（evict）。

### FR-3: ペインの自動クリーンアップ

- **FR-3.1**: サブエージェントセッションが `session.idle` イベントを発行した場合、対応するペインを閉じる。
- **FR-3.2**: サブエージェントセッションが `session.error` イベントを発行した場合、対応するペインを閉じる。
- **FR-3.3**: サブエージェントセッションが `session.deleted` イベントを発行した場合、対応するペインが閉じられていなければ閉じる。

---

## 5. 非機能要件

- **堅牢性**: `opencode attach` や SSE の接続に失敗しても、プラグイン本体がクラッシュしないこと。エラーはログに記録する。
- **パフォーマンス**: 同時に複数のサブエージェントが起動しても、UI の応答性が損なわれないこと（ペイン分割・削除が迅速であること）。
- **セキュリティ**: `opencode` CLI に渡す引数は、セッションIDやURLなどを適切にエスケープし、インジェクションを防ぐこと。

---

## 6. 設定スキーマ

### 6.1 設定構造

```typescript
// opencode.jsonc の "sibyl" または "akane" の下にネストされる想定
interface SibylSubagentConfig {
  subagentDisplay: {
    enabled: boolean;   // default: false
    maxPanes: number;   // default: 4
  };
}
```

### 6.2 設定解決の優先順位

`sibyl` プラグインが読み込まれた際、以下の優先順位で設定を解決する。

1.  **akane の設定** (`akane.experimental.watchdog.subagentDisplay`)
2.  **sibyl の設定** (`sibyl.subagentDisplay`)
3.  **環境変数** (例: `SIBYL_SUBAGENT_MAX_PANES`)

---

## 7. イベントフロー

1.  **初期化**: `tui.tsx` が `SubagentLifecycleManager` を初期化。`ConfigResolver` で設定を読み込み、有効であればイベント購読を開始する。
2.  **検出**: OpenCode から `session.created` イベントが届く。
    - `parentID` があれば、`SubagentLifecycleManager` に `create` を指示。
3.  **作成**: `SubagentLifecycleManager` が `SubagentPaneAdapter` に `openChildSession` を要求。
    - `SubagentPaneAdapter` は `PaneBackend` に新しいペインを分割させ、`opencode attach ...` を実行する PTY プロセスを割り当てる。
    - ペイン数が上限を超えた場合、最も古いペインを閉じるコマンドを `SubagentPaneAdapter` に要求する。
4.  **アイドル**: OpenCode から `session.idle` イベントが届く。
    - `SubagentLifecycleManager` が `SubagentPaneAdapter` に `closeChildSession` を要求。
    - `SubagentPaneAdapter` が対応するペインを閉じる。
5.  **エラー/削除**: `session.error` または `session.deleted` が届いた場合も同様にペインを閉じる。

---

## 8. テスト戦略

- **Unit テスト**:
    - `SubagentLifecycleManager`: 各種イベントに対する状態遷移と、`SubagentPaneAdapter` への指示が正しく行われるか。
    - `SubagentPaneAdapter`: `opencode attach` のコマンドライン引数が正しく生成されるか。
    - `ConfigResolver`: 設定の優先順位が正しく解決されるか。
- **Smoke テスト**:
    - OpenCode を起動し、sibyl プラグインをロードする。
    - `oh-my-openagent` などでサブエージェントを spawn する。
    - Sibyl の TUI に新しいペインが自動的に作成され、`opencode attach --mini` の TUI が表示されることを目視で確認する。
    - サブエージェントが完了（idle）したときに、ペインが自動的に閉じることを確認する。

---

## 9. 実装フェーズ

1.  **Phase 1**: 設計書確定 (本タスク)
2.  **Phase 2**: 実装計画作成 (`writing-plans` スキル)
3.  **Phase 3**: 実装
4.  **Phase 4**: テストとレビュー
