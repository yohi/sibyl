# Sibyl Architecture

## 現行データフロー

```text
OpenCode EventBus / client / state
  -> safe normalizer and snapshot reader
  -> parent-scoped SubagentRegistry
  -> SidebarObserver
  -> SubagentCard list in sidebar_content
```

Sibyl v2 の TUI エントリポイントは Observer の初期設定を一度だけ解決し、有効な場合に `sidebar_content` スロットだけを登録します。描画対象はスロットの `session_id` に直接紐づく子セッションです。

## コンポーネント

### `subagent-config.ts` / `subagent-validation.ts`

Observer の 9 項目を環境変数、TUI plugin options、`sibyl.observer`、デフォルト値の順で個別に解決します。整数範囲、真偽値形式、表示数と追跡数の関係を検証します。旧設定は存在だけを検出し、値は読み込みません。

### `subagent-redaction.ts` / `subagent-normalizer.ts`

外部 API や EventBus の未知値を境界で検査し、安全な Session、Message、Part、Tool 状態へ射影します。表示テキストは機密らしい値を `[redacted]` に置換してから上限長へ切り詰めます。

### `subagent-event-source.ts`

TUI EventBus または既存 transport を利用する SSE 実装からイベントを受け取り、正規化済み Observer イベントとして配信します。接続先、認証情報、ディレクトリを設定として受け取りません。

### `subagent-snapshot-reader.ts`

現在の親 ID に対する子セッション、状態、限定数の Message と Part を読み取ります。`parentID` の完全一致を確認し、取得数、Message 参照、Part 参照、並行 hydration 数を制限します。

### `subagent-registry.ts`

親セッション単位の状態所有者です。初期 snapshot とイベントの競合を吸収し、状態変更を coalesce して購読者へ通知します。

#### Bounded state 契約

`maxTrackedSubagents` は、現在の親に属する安全な直接の子 Session のうち、hydrated な詳細状態を持つ `tracked` entry 数だけを制限します。`maxVisibleSubagents` は表示数の制限であり、表示されない下位順位の tracked entry を削除するものではありません。hydration 中の pending child bucket、capacity 超過 child の omitted-ID deduplication set、削除済み child の tombstone set は tracked entry とは別の補助状態ですが、それぞれも `maxTrackedSubagents` 件に制限します。各 child の pending event、activity history、message/part reference も coalescing と個別の reference limit で bounded に保ちます。

capacity が満杯のときは、retention deadline を過ぎた `idle` entry だけを期限順に退避できます。`busy`、`retry`、`error`、`unknown` の entry、retention 中の `idle` entry、および retention deadline が未設定の `idle` entry は active とみなし、capacity 超過を理由に削除・status変更しません。退避候補がなければ新しい child の詳細状態を省略し、ID 一覧を無制限に保存せず、bounded な飽和型 `overflowCount` を更新します。

snapshot reader の `omittedCount` は、その snapshot で追跡容量から外れた直接の子候補数です。Registry の `overflowCount` は snapshot omission と event admission failure をまとめた aggregate indicator で、distinct omitted ID 数を保証しません。初期 snapshot と成功した resync では snapshot の omission を基準に再設定し、event 由来の同一 ID は bounded set で重複排除します。既知の omitted child の削除時だけ減算し、親変更・停止時には補助状態とともにクリアします。

容量解放後または次の成功した snapshot/resync 時に、直接の子候補を urgency、更新時刻、ID の順で再選択します。`session.upsert` は空きがある場合、または期限切れ idle entry を退避できる場合に再追跡されます。削除、idle retention expiry、source reconnect は resync を要求し、tombstone で stale snapshot からの再登録を防ぎます。

### `subagent-observer.tsx`

`SidebarObserver` が Registry の snapshot を購読し、`SubagentCard` のスクロール可能なリストを描画します。Theme の状態色を使い、設定された Model、Provider、最新テキスト、公開 reasoning summary だけを条件付きで表示します。

### `subagent-integration.ts` / `tui.tsx`

Observer が無効な場合は source、Registry、slot を生成しません。有効な場合は OpenCode API から snapshot reader と EventBus source を構成し、`sidebar_content` と lifecycle cleanup だけを登録します。

## ライフサイクルとクリーンアップ

1. TUI 起動時に Observer 設定を解決します。
2. 無効なら no-op handle を返します。
3. 有効なら EventBus source、snapshot reader、Registry を生成します。
4. `sidebar_content` が親 ID を受け取るたびに Registry がその親を選択します。
5. `api.lifecycle.onDispose()` から Registry の停止を await します。
6. 停止処理は冪等で、イベント購読、再同期、購読者を解放します。

Observer はプロセスを生成しないため、PTY や shell の終了処理を所有しません。

## 安全境界

- 外部データは normalizer を通過するまで Registry に入りません。
- 生の SDK オブジェクト、Tool payload、Tool output、error、metadata、credential は保持しません。
- ログには静的な操作識別子と sanitized error category だけを出力します。
- `maxTrackedSubagents` を超えた直接の子は、上記の bounded state 契約に従って詳細状態を保持せず、aggregate overflow として扱います。無制限の child entry、pending bucket、omitted ID、tombstone は保持しません。

## 現在の制限

- OpenTUI の `sidebar_content` slot API に依存します。
- 状態や Message の利用可能性は OpenCode host の EventBus、client、state API に依存します。
- Model、Provider、最新テキスト、公開 reasoning summary は入力データに存在しない場合は表示されません。
- Akane 連携は現行 Observer の範囲外です。

## v1 との関係

以前のマルチペイン・プロセス管理設計は v1 の履歴です。現行 TUI Observer はその経路を利用せず、移行理由とリリース履歴は [CHANGELOG.md](../CHANGELOG.md) に記録しています。
