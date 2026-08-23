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
- `reasoning`: top-level の `summaryVisibility === "public"` と string の `publicSummary` がともにある公開 summary のみ。生の `ReasoningPart.text` や metadata から summary を探索しない
- `tool`: 安全な Tool 名と状態、更新時刻

Tool payload、Tool output、Tool error、Tool title、添付、metadata は読まず、投影結果にも含めません。

Tool 活動は part の `id` で識別し、`id` を持たない未知の payload に限り `callID` へフォールバックします。同一 ID の活動は `pending` → `running` → `completed`/`error` の状態遷移を上書き更新し、重複する履歴項目を追加しません。

### 5.4 Redaction と識別子

テキストは redaction を先に行い、その後で長さ制限を適用します。置換値は常にリテラル `[redacted]` で、次の固定順序で決定論的に適用します。

1. `authorization`、`password`、`secret`、`token`、`api_key`、`apikey`(大小文字非依存)のフィールド名や代入に続く値
2. `Basic`、`Bearer` 等の認証 scheme に続く資格情報
3. 既知の API key・access token リテラル
4. 機密環境変数代入(名前と値の組)
5. 長さ制限の適用

既定上限は最新 Assistant テキストと公開 reasoning summary が 160 文字、表示識別子と Tool 名が 64 文字、相関 ID が 128 文字です。

ID と表示名には最大長と英数字を中心とする syntax check を適用します。無効な値を投影できない場合は、その Session、Message、Part を破棄します。無効な Tool 名だけは `unknown` に置換します。

### 5.5 Agent 名と Model の解決

Agent 名は最新の AgentPart 名、次に Subtask agent、最後に UserMessage agent の優先順で解決し、すべて無効な場合は `unknown` とします。Model は最新の Assistant Message の provider/model を優先し、無効な場合は User Message の model 選択へフォールバックします。解決できない provider/model は表示から省略します。

## 6. Event と snapshot

### 6.1 Event source

`TuiEventBusSource` は host の EventBus を購読します。`SseEventSource` は host が提供する既存 transport を使う差し替え可能な source です。どちらも接続先や認証情報を受け取りません。

両 source は次の OpenCode イベントを同じ正規化契約で処理します。

| OpenCode イベント | 相関キーと正規化効果 |
| --- | --- |
| `session.created` / `session.updated` | `properties.info.id` と `properties.info.parentID`。直接の子を upsert または再スコープ |
| `session.deleted` | `properties.sessionID`。子と保持データを削除 |
| `message.updated` / `message.removed` | `properties.sessionID` と `properties.info.id` または `properties.messageID`。Message 由来フィールドを更新または除去 |
| `message.part.updated` / `message.part.removed` | `properties.sessionID`、part の `messageID`、part の `id` または `properties.partID`。Part 由来フィールドを更新または除去 |
| `session.status` / `session.idle` / `session.error` | `properties.sessionID`。runtime status と retention 処理へ正規化 |
| `session.next.retried` | `properties.sessionID` と `attempt`。後続の status/idle/error/削除イベントが上書きするまで `retry` を維持 |

Event stream を子の作成、idle、error、削除のみへ縮小してはなりません。Assistant テキストは Assistant Message と相関した text part からのみ派生し、Tool 活動は part の `id`(`callID` フォールバック)で相関します。

不正なイベントは無視または sanitized error として扱い、TUI をクラッシュさせません。

### 6.2 Snapshot

起動時、親変更時、再接続時に次を行います。

1. 親の直接の子 Session を取得する。
2. status を `busy`、`idle`、`retry`、`error`、`unknown` に正規化する。
3. 最大 32 件の Message と最大 64 件の Part 参照を安全投影する。
4. 最大 8 並列で選択済み子 Session を hydrate する。
5. snapshot 後に到着したイベントを source order で適用する。

Snapshot の対象外になった子は `omittedCount` に反映します。`omittedCount` は、親に属する安全な直接の子候補のうち、snapshot reader の追跡容量に入らなかった件数です。削除済みとして tombstone で無視した ID や親が一致しない Session は候補数にも含めません。

### 6.3 初期化と再同期の競合解消

親を選択するときは、snapshot を読み取る前に event source を購読します。読み取り中に到着した正規化イベントは bounded にバッファし、snapshot の適用後に source order で再生します。reconciliation が完了するまで Registry を ready にせず、Sidebar は child card を描画しません。

再同期では、読み取り開始時点の最終 sequence を watermark とし、読み取り中のイベントをバッファします。新しい snapshot を適用した後、watermark より後のイベントを source order で適用します。親の切り替え、停止、または後続の読み取りによって stale になった読み取り結果は破棄します。

### 6.4 Snapshot failure isolation

abort 以外で初期 snapshot が失敗した場合、Registry は buffered event を再生して ready 状態へ移行し、sanitized failure を記録しつつ event source を維持します。永久に loading 表示のままにしてはなりません。

abort 以外で resync が失敗した場合、既存の tracked view を破棄せず、watermark より後の buffered event を適用して event source を維持します。失敗した読み取りが別の親や新しい読み取り結果を上書きしてはなりません。

## 7. Registry と表示

`SubagentRegistry` は親 ID、hydrated child、pending correlation、activity history、message/part reference、resync を所有します。

### 7.1 Tracking capacity と bounded overflow

`maxTrackedSubagents` は、現在選択されている親に属する直接の子 Session について、hydrated な詳細状態を持つ Registry entry 数の上限です。候補は安全に正規化され、`parentSessionId` が現在の親 ID と完全一致する Session に限ります。`maxVisibleSubagents` は表示するカード数だけを制限し、追跡済みだが表示順位が下位の child entry は Registry に残します。

`pending correlation` の child bucket、capacity 超過した Session ID の重複排除用 `omitted` set、削除済み Session の tombstone set は tracked entry とは別の補助状態です。これらも `maxTrackedSubagents` 件を上限とし、各 bucket 内のイベントや参照は既定の coalescing と reference limit で bounded に保ちます。Session の詳細、raw event、無制限の omitted ID 一覧は capacity を超えて保持しません。

ここでいう active entry（capacity eviction の対象外）は、`busy`、`retry`、`error`、`unknown` の child、retention deadline がまだ到来していない `idle` child、または retention deadline が未設定の `idle` child です。capacity 超過時は、まず retention deadline を過ぎた `idle` entry のうち期限の早いものだけを退避候補にします。退避可能な entry がない場合、新しい直接の子の詳細状態を追跡せず、既存の active entry を削除せず、status や保持中の参照も変更しません。

capacity 超過を表す `overflowCount` は、bounded な aggregate indicator です。Session ID の一覧や、現在の distinct omitted child 数を保証する値ではありません。

- 初期 snapshot と成功した resync では、snapshot の `omittedCount` と、reader が上限を超えて返した追加 child 数を基準に再設定します。過去の snapshot の値を累積しません。
- capacity が空いておらず event 経由の新規 child を追跡できない場合は、同じ Session ID を bounded omitted set で重複排除して加算します。set の上限を超えた新規省略も、counter 自体を飽和加算します。
- 既知の event-originated omitted child が削除された場合は omitted set から除去し、counter を 0 未満にならないよう減算します。counter が飽和済みの場合は、次の成功した snapshot で基準値が確定するまで飽和状態を維持します。
- 親の切り替えまたは Registry の停止時は tracked、pending、omitted、tombstone とともに 0 に戻します。

`overflowCount` は、`maxVisibleSubagents` を超えているが追跡自体は継続している view の件数を含みません。Sidebar の omitted 表示は、`overflowCount` と表示上限を超えた tracked view 数を合算したものです。

容量が解放されたとき、または次の snapshot/resync が成功したときに再追跡を試みます。新しい `session.upsert` は空きがある場合、または期限切れの idle entry を退避できる場合に admission されます。snapshot/resync では、候補を urgency、更新時刻、ID の順で再選択します。削除、idle retention expiry、source reconnect は resync を要求します。tombstone が残る削除済み ID は stale snapshot から再登録せず、後続の成功した snapshot で tombstone の扱いが確定するまで除外します。

- `maxVisibleSubagents` 件だけをカードとして表示します。
- カードは緊急度 `error` > `retry` > `busy` > `idle` > `unknown`、同順位は直近の活動が新しい順に並べます。
- `activityLimit` を超える履歴は保持しません。
- `idleRetentionMs` が経過した idle child は破棄対象です。
- delete は即時に反映します。
- イベント burst は UI 更新前に child session と tool identity 単位で coalesce し、OpenCode イベント発生から 250 ms 以内の描画を目標とします。
- Registry snapshot は Solid subscriber が読み取る immutable view です。

`SubagentCard` は Agent 名と status を必ず表示し、設定に応じて Model、Provider、最新 Assistant テキスト、公開 reasoning summary、Tool activity を表示します。状態色は host theme の `error`、`warning`、`info`、`success`、`textMuted` を使います。
現在の活動は `running` を最優先し、次いで `pending` を選択します。完了・失敗した Tool は `activityLimit` 件までの bounded 履歴にだけ残ります。

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

Akane などの外部設定・表示システムとの連携は、現行 Observer の境界外です。Akane との統合は、Akane が版号付きの互換公開統合 API を公開した後でのみ開始します。その段階では既存 runtime view を補強する optional health adapter を追加するにとどめ、watchdog や recovery の挙動を Sibyl 側へ移しません。再導入する場合は、設定の所有権、データ allowlist、secret handling、ライフサイクルを別仕様として定義し、既存の Observer core に暗黙依存させません。
