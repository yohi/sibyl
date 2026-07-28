# 🧠 sibyl

**OpenCode Multi-Pane Integrated Console Plugin**

> 「並列化された思考を統合し、全プロセスの秩序を統制する。」

`sibyl` は、[OpenCode](https://github.com/anomalyco/opencode) 環境下で稼働する複数のエージェントプロセスを一元管理し、**Tmuxなどの外部ツールを一切使うことなく**、単一のターミナル内で動的な画面分割とPTY（疑似端末）制御を完結させるマルチペイン統合コンソールプラグインです。

アニメ『PSYCHO-PASS』の「シビュラシステム」をコンセプトとし、並列して動作するエージェント（脳）たちを一つのTUI空間に統合します。Solid.js + OpenTUI による高速なFlexboxレイアウト制御と `node-pty` による非同期プロセス管理により、追加のミドルウェアなしでスムーズなマルチペイン操作環境を提供します。また、監視官プラグイン `akane` と連携し、全ペインの健全性を可視化する中央管制コンソールとして機能します。

## Development

```bash
bun install
bun run build
bun test
```
