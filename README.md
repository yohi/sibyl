# Sibyl v2 Observer

Sibyl は OpenCode TUI の `sidebar_content` に、現在の親セッションから直接生成された子セッションを表示する読み取り専用 Observer プラグインです。

Observer はデフォルトで無効です。有効化しても、セッションの作成・編集・削除、プロンプト送信、権限変更、モデル変更、PTY 起動、シェル起動は行いません。

## インストール

TUI プラグインだけを登録します。

```json
{
  "plugin": ["@yohi/sibyl/tui"]
}
```

旧 Server プラグインや互換ルートの登録は不要です。

## Observer 設定

ホスト設定では `sibyl.observer` に設定します。プラグインオプションを使う場合は `observer` オブジェクトを渡します。

```jsonc
{
  "sibyl": {
    "observer": {
      "enabled": false,
      "maxVisibleSubagents": 8,
      "maxTrackedSubagents": 64,
      "activityLimit": 5,
      "idleRetentionMs": 300000,
      "showModel": true,
      "showProvider": true,
      "showLatestText": true,
      "showReasoningSummary": true
    }
  }
}
```

| 項目 | デフォルト | 有効範囲 |
| --- | ---: | --- |
| `enabled` | `false` | `true` / `false` |
| `maxVisibleSubagents` | `8` | `1`〜`8` |
| `maxTrackedSubagents` | `64` | `8`〜`256`。表示数以上 |
| `activityLimit` | `5` | `1`〜`20` |
| `idleRetentionMs` | `300000` | `0`〜`3600000` |
| `showModel` | `true` | `true` / `false` |
| `showProvider` | `true` | `true` / `false` |
| `showLatestText` | `true` | `true` / `false` |
| `showReasoningSummary` | `true` | `true` / `false` |

値は項目ごとに次の順で解決されます。

```text
環境変数 > TUI pluginOptions.observer > sibyl.observer > デフォルト値
```

環境変数は次の 9 個です。

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

環境変数の真偽値は `true` / `false` または `1` / `0`、整数値は 10 進整数です。選択された値が不正な場合、下位の設定へフォールバックせず起動を拒否します。

## 表示内容とプライバシー

Observer が保持・表示するのは安全投影済みの次の情報だけです。

- 直接の子セッションの安全な ID、親 ID、作成時刻、更新時刻
- 状態（`busy`、`idle`、`retry`、`error`、`unknown`）
- Agent 名、Provider 名、Model 名
- 最新の Assistant テキスト
- 公開設定された reasoning summary
- 現在および最近の Tool 名と状態（`pending`、`running`、`completed`、`error`）

表示テキストは機密情報を置換してから長さ制限を適用します。置換文字列は常に `[redacted]` です。生の reasoning、Tool の入力・出力・エラー・タイトル、添付ファイル、メタデータ、環境変数、認証情報、API キーは投影・保存・描画しません。

セッション ID、メッセージ ID、Part ID、Agent 名、Provider 名、Model 名、Tool 名は長さと文字種を検証し、安全な値だけを保持します。無効な Tool 名は `unknown` として扱われます。

## Observer の境界

- 現在 `sidebar_content` に渡された `session_id` と `parentID` が完全一致する子だけを追跡します。
- 孫セッションを再帰的に追跡しません。
- 表示順と状態は `SubagentRegistry` が管理します。
- Observer は OpenCode の EventBus と既存の client/state API を読み取るだけです。
- Sibyl の route、keymap、layout controller、pane backend、PTY、shell、attach process は Observer 経路にありません。
- 旧設定値を検出した場合は起動ごとに 1 回だけ警告し、Observer 設定には取り込みません。
- Akane はロード、設定、参照、描画しません。

## 開発

```bash
bun install
bun run lint
bun run typecheck
bun run test
bun run build
```

詳細な契約は [SPEC.md](./SPEC.md)、実装構造は [docs/architecture.md](./docs/architecture.md)、移行履歴は [CHANGELOG.md](./CHANGELOG.md) を参照してください。
