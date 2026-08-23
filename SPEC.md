# Sibyl v2 Observer 仕様書

本仕様書は `@yohi/sibyl/tui` の現行 Observer 契約を定義します。Observer は OpenCode TUI の既存データを読み取り、アクティブな親セッションの直接の子セッションを `sidebar_content` に表示します。

## 1. 製品境界

### 1.1 目的

- 現在の OpenCode セッションに属する直接の子セッションを一覧表示する。
- EventBus の更新と初期 snapshot を同じ Registry に統合する。
- 表示情報を安全な allowlist に限定し、機密情報を描画しない。
- 子セッション数、活動履歴、参照数を bounded に保つ。

### 1.2 非目標

Observer は次の操作を実行しません。

- セッションの作成、編集、削除、再実行
- Prompt、Tool、Permission の送信または変更
- Model、Agent、Provider の変更
- route、keymap、layout、pane の登録または操作
- PTY、shell、外部 process の起動
- 接続先、ディレクトリ、認証情報の解決
- Akane のロード、設定、参照、描画

## 2. 構成

```text
OpenCode TUI
  └─ @yohi/sibyl/tui
       ├─ resolveObserverConfig
       ├─ ObserverEventSource
       ├─ ObserverSnapshotReader
       ├─ SubagentRegistry
       └─ sidebar_content -> SidebarObserver -> SubagentCard
```

`src/index.ts` は server-safe な Observer core API を公開し、Solid/OpenTUI の描画配線は `./tui` エントリに限定します。

## 3. Observer 設定

### 3.1 設定型とデフォルト

| 項目 | 型 | デフォルト | 範囲・形式 |
| --- | --- | ---: | --- |
| `enabled` | boolean | `false` | `true` / `false` |
| `maxVisibleSubagents` | integer | `8` | `1`〜`8` |
| `maxTrackedSubagents` | integer | `64` | `8`〜`256`、表示数以上 |
| `activityLimit` | integer | `5` | `1`〜`20` |
| `idleRetentionMs` | integer | `300000` | `0`〜`3600000` |
| `showModel` | boolean | `true` | `true` / `false` |
| `showProvider` | boolean | `true` | `true` / `false` |
| `showLatestText` | boolean | `true` | `true` / `false` |
| `showReasoningSummary` | boolean | `true` | `true` / `false` |

### 3.2 解決順序

各項目は独立して次の順で選択します。

```text
SIBYL_OBSERVER_* > pluginOptions.observer > sibyl.observer > default
```

環境変数は次のとおりです。

| 項目 | 環境変数 |
| --- | --- |
| `enabled` | `SIBYL_OBSERVER_ENABLED` |
| `maxVisibleSubagents` | `SIBYL_OBSERVER_MAX_VISIBLE_SUBAGENTS` |
| `maxTrackedSubagents` | `SIBYL_OBSERVER_MAX_TRACKED_SUBAGENTS` |
| `activityLimit` | `SIBYL_OBSERVER_ACTIVITY_LIMIT` |
| `idleRetentionMs` | `SIBYL_OBSERVER_IDLE_RETENTION_MS` |
| `showModel` | `SIBYL_OBSERVER_SHOW_MODEL` |
| `showProvider` | `SIBYL_OBSERVER_SHOW_PROVIDER` |
| `showLatestText` | `SIBYL_OBSERVER_SHOW_LATEST_TEXT` |
| `showReasoningSummary` | `SIBYL_OBSERVER_SHOW_REASONING_SUMMARY` |

環境変数の boolean は `true`、`false`、`1`、`0` のいずれかです。integer は符号なしの 10 進整数で、範囲外・小数・不正文字列は `SubagentValidationError` とします。`maxTrackedSubagents < maxVisibleSubagents` も拒否します。

### 3.3 旧設定

旧 display、connection、directory、credential、attach 設定は値を Observer 設定へ変換しません。存在を検出した場合、TUI plugin の 1 回の起動につき 1 回だけ deprecation warning を出し、すべて破棄します。

## 4. セッション境界

- `sidebar_content` の `props.session_id` を現在の親 ID とします。
- Session の `parentID` が親 ID と完全一致するものだけを候補にします。
- 孫セッションや別親のセッションは表示しません。
- 親の切り替え時は、前の親の表示を空にして新しい snapshot を読み取ります。

## 5. 安全投影

### 5.1 Session

保持する Session 情報は ID、親 ID、作成時刻、更新時刻だけです。

### 5.2 Message

保持する Message 情報は ID、Session ID、role、作成時刻、Assistant の完了時刻と error 有無、User Message の Agent 名、User または Assistant の Provider/Model 候補だけです。

### 5.3 Part

allowlist は次の種類です。

- `agent`: 安全な Agent 名
- `subtask`: 安全な Agent 名
- `text`: Assistant のテキストのみ
- `reasoning`: `summaryVisibility === "public"` の公開 summary のみ
- `tool`: 安全な Tool 名と状態、更新時刻

Tool payload、Tool output、Tool error、Tool title、添付、metadata は読まず、投影結果にも含めません。

### 5.4 Redaction と識別子

テキストは redaction を先に行い、その後で長さ制限を適用します。認証 scheme、名前付き secret、既知の token 形式、機密環境変数 assignment は `[redacted]` に置換します。

ID と表示名には最大長と英数字を中心とする syntax check を適用します。無効な値を投影できない場合は、その Session、Message、Part を破棄します。無効な Tool 名だけは `unknown` に置換します。

## 6. Event と snapshot

### 6.1 Event source

`TuiEventBusSource` は host の EventBus を購読します。`SseEventSource` は host が提供する既存 transport を使う差し替え可能な source です。どちらも接続先や認証情報を受け取りません。

イベントは次の状態へ正規化します。

- Session 作成、更新、idle、error、削除
- Message 更新
- Part 更新

不正なイベントは無視または sanitized error として扱い、TUI をクラッシュさせません。

### 6.2 Snapshot

起動時、親変更時、再接続時に次を行います。

1. 親の直接の子 Session を取得する。
2. status を `busy`、`idle`、`retry`、`error`、`unknown` に正規化する。
3. 最大 32 件の Message と最大 64 件の Part 参照を安全投影する。
4. 最大 8 並列で選択済み子 Session を hydrate する。
5. snapshot 後に到着したイベントを source order で適用する。

Snapshot の対象外になった子は `omittedCount` または bounded overflow counter に反映します。

## 7. Registry と表示

`SubagentRegistry` は親 ID、hydrated child、pending correlation、activity history、message/part reference、resync を所有します。

- `maxTrackedSubagents` を超える候補は無制限に保持しません。
- `maxVisibleSubagents` 件だけをカードとして表示します。
- `activityLimit` を超える履歴は保持しません。
- `idleRetentionMs` が経過した idle child は破棄対象です。
- delete は即時に反映します。
- active entry は capacity 超過時に自動削除しません。
- イベント burst は coalesce して購読者を通知します。
- Registry snapshot は Solid subscriber が読み取る immutable view です。

`SubagentCard` は Agent 名と status を必ず表示し、設定に応じて Model、Provider、最新 Assistant テキスト、公開 reasoning summary、Tool activity を表示します。状態色は host theme の `error`、`warning`、`info`、`success`、`textMuted` を使います。

## 8. TUI API と cleanup

`attachSubagentIntegration` は次の host capability だけを使用します。

- `client.session`
- `event`
- `state.session`
- `state.part`
- `slots.register`
- `theme`
- `lifecycle`

有効時に登録する slot は `sidebar_content` の 1 個だけです。`api.lifecycle.onDispose()` には Registry の `stop()` を登録し、source、resync、購読者を冪等に解放します。無効時は source、snapshot reader、Registry、slot を生成しません。

## 9. 公開 API と package surface

root entry は設定、validation、redaction、normalizer、event source、snapshot reader、Registry、generic library core を公開します。UI の `attachSubagentIntegration`、`createTuiPlugin`、default TUI module は `@yohi/sibyl/tui` から公開します。

Observer v2 には独立した Server entry はありません。

## 10. セキュリティ要件

- raw SDK response と raw event payload を Registry に保存しません。
- raw reasoning、Tool payload/output/error/title、attachments、metadata、credentials、environment values を投影・表示しません。
- ログは static operation identifier と sanitized error category に限定します。
- redaction 前の文字列を truncate しません。
- 認証情報や API key を command line、ログ、TUI frame に出しません。

## 11. 受け入れ基準

- Observer が無効な場合、TUI 起動は source、Registry、slot を生成しません。
- Observer が有効な場合、登録されるのは `sidebar_content` だけです。
- 直接の子 1 件、複数件、最大表示数超過、idle retention、削除、親変更を正しく扱います。
- 初期 hydrate 中の event と再同期中の event を失わずに適用します。
- Agent、Subtask、Assistant text、公開 reasoning summary、Tool transition を正しく表示します。
- malformed event がクラッシュや raw payload の表示を起こしません。
- TUI bundle に route、keymap、PTY、shell、attach の実行経路が含まれません。
- 旧設定は警告だけを出し、Observer の設定や挙動を変更しません。
- `bun run lint`、`bun run typecheck`、`bun run test`、`bun run build` が成功します。

## 12. v1 historical context

v1 は PTY を利用したマルチペイン統合コンソールを試験した世代でした。v2 Observer はその実行経路を製品の現行 TUI 契約から外し、読み取り専用の sidebar data flow に置き換えています。リリース上の移行記録は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## 13. 将来検討

Akane などの外部設定・表示システムとの連携は、現行 Observer の境界外です。再導入する場合は、設定の所有権、データ allowlist、secret handling、ライフサイクルを別仕様として定義し、既存の Observer core に暗黙依存させません。
