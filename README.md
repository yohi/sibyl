# 🧠 sibyl

**OpenCode Multi-Pane Integrated Console Plugin**

> 「並列化された思考を統合し、全プロセスの秩序を統制する。」

`sibyl` は、[OpenCode](https://github.com/anomalyco/opencode) 環境下で稼働する複数のエージェントプロセスを一元管理し、**Tmuxなどの外部ツールを一切使うことなく**、単一のターミナル内で動的な画面分割とPTY（疑似端末）制御を完結させるマルチペイン統合コンソールプラグインです。

Solid.js + OpenTUI による高速な Flexbox レイアウト制御と PTY アダプター（`node-pty` および Bun 内蔵 POSIX PTY）による非同期プロセス管理により、スムーズなマルチペイン操作環境を提供します。

---

## ⚡ Keybindings & Commands

OpenCode TUI 内で以下のショートカットキーおよびコマンドパレットを利用してペインを操作できます。

| キーバインド | コマンド ID | 説明 |
| :--- | :--- | :--- |
| `ctrl+shift+s` | `sibyl.open` | Sibyl マルチペインコンソールを開く |
| `ctrl+a h` | `sibyl.split.horizontal` | フォーカス中のペインを横分割（左右） |
| `ctrl+a v` | `sibyl.split.vertical` | フォーカス中のペインを縦分割（上下） |
| `ctrl+a n` | `sibyl.focus.next` | 次のペインへフォーカス移動 |
| `ctrl+a p` | `sibyl.focus.prev` | 前のペインへフォーカス移動 |
| `ctrl+a x` | `sibyl.close` | フォーカス中のペインを閉じる |
| *(パレットのみ)* | `sibyl.showSubagentDisplayConfig` | サブエージェント自動表示の設定状態を表示 |

---

## 📦 Installation

`opencode.json` (Server plugin):

```json
{
  "plugin": ["@yohi/sibyl/server"]
}
```

`tui.json` (TUI plugin):

```json
{
  "plugin": ["@yohi/sibyl/tui"]
}
```

---

## 🤖 Subagent Display Integration

`oh-my-openagent` などのプラグインが起動するサブエージェントセッションを検知し、Sibyl 内に自動ペインとして表示・管理できます（Tmux 不要）。

### 設定項目（`opencode.json` / `tui.json`）

```jsonc
{
  "sibyl": {
    "subagentDisplay": {
      "enabled": true,   // サブエージェント自動表示の有効化（デフォルト: false）
      "maxPanes": 4      // 表示ペインの上限数（1〜8、0 で自動閉鎖し無効化）
    }
  }
}
```

### 環境変数によるオーバーライド

設定は `環境変数 > akane 設定 > sibyl 設定 > pluginInput` の優先順位で項目単位にマージ解決されます。

- `SIBYL_SUBAGENT_ENABLED`: `true` / `false`（または `1` / `0`）
- `SIBYL_SUBAGENT_MAX_PANES`: 最大表示ペイン数（`1`〜`8`、`0` で無効化）
- `OPENCODE_SERVER_URL`: OpenCode サーバー URL（例: `http://localhost:4096`）
- `OPENCODE_PROJECT_DIR`: 対象プロジェクトのルートディレクトリパス
- `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD`: サーバー認証情報（引数やログには露出せず環境変数で安全に伝播）

---

## 🛠 Development

```bash
# 依存関係のインストール
bun install

# ビルド
bun run build

# テスト実行
bun run test

# Biome コードチェック
bun run lint

# TypeScript 型チェック
bun run typecheck
```

---

## 📄 Specification & Architecture

技術仕様および詳細なアーキテクチャについては [SPEC.md](./SPEC.md) および [docs/architecture.md](./docs/architecture.md) を参照してください。
