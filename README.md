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
```

---

## 📄 Specification & Architecture

技術仕様および詳細なアーキテクチャについては [SPEC.md](./SPEC.md) および [docs/architecture.md](./docs/architecture.md) を参照してください。
