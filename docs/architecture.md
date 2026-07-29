# Sibyl Architecture

## コンポーネント

- `PtyManager`: `node-pty` プロセスの起動・終了・リサイズ。
- `LayoutManager`: 再帰的な Flexbox ペインレイアウト。
- `Pane`: 1 つのペインを表す Solid コンポーネント。
- `PaneBackend`: OpenTUI 実装と外部アダプターのための抽象。
- `OpenTuiPaneBackend`: OpenTUI + PTY 版。
- `TmuxPaneBackend`: Sibyl 本体には含めず、別パッケージまたは外部アダプターで提供する既存 Tmux 版互換。

## PTY 出力の表示方式ロードマップ

1. **最小限方式（現在）**: ANSI strip してテキスト表示。
2. **ANSI 解釈方式（将来）**: `xterm-headless` 等で仮想画面を解釈。
3. **セルマトリクス方式（将来）**: OpenTUI ネイティブにセル状態を書き込む専用 renderable。
