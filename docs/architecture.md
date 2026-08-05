# Sibyl Architecture

## コンポーネント

`PtyManager`: PTY アダプターによるプロセスの起動・終了・リサイズ（`node-pty` および Bun 内蔵 POSIX PTY に対応）。
- `LayoutManager`: 再帰的な Flexbox ペインレイアウト。
- `Pane`: 1 つのペインを表す Solid コンポーネント。
- `PaneBackend`: OpenTUI 実装と外部アダプターのための抽象。
- `OpenTuiPaneBackend`: OpenTUI + PTY 版。
- `TmuxPaneBackend`: Sibyl 本体には含めず、別パッケージまたは外部アダプターで提供する既存 Tmux 版互換。

1. **最小限方式（現在）**: ANSI strip してテキスト表示。
2. **ANSI 解釈方式（将来）**: `xterm-headless` 等で仮想画面を解釈。
3. **セルマトリクス方式（将来）**: OpenTUI ネイティブにセル状態を書き込む専用 renderable。

## 現在の制限事項

- **ペイン単位 PTY サイズ**: OpenTUI Solid は現時点でペイン単位のサイズ API を
  提供していないため、各 `Pane` は端末全体の `cols`/`rows` を PTY リサイズに
  使用しています。分割ペインも同一サイズを共有する状態になります。これは計画の
  「端末サイズ -> PTY サイズ」同期要件を満たす実装であり、API 提供時に
  ペイン単位サイズへ移行する予定です。
