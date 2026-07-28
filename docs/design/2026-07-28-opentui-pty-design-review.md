# OpenTUI + PTY マルチペイン統合：設計レビュー

> 対象ドキュメント: `REQUIREMENTS.md`（OpenTUIによる「Tmuxを使わない」マルチペイン統合）
> レビュー日: 2026-07-28
> レビュアー: Sisyphus

---

## 1. 前提の整理

本レビューは、対象要件定義書を OpenCode プラグインとして実装する前提で査読したものです。  
結論として、要件書は**方向性は正しい**が、**OpenCode / OpenTUI / node-pty の実 API に即した具体性に欠けており、実装に進む前に以下の補足・修正が必要**です。

### 1.1 プロジェクト位置づけ（確認済み）

- `sibyl` リポジトリ自体が OpenCode プラグインの実装先となる。
- npm パッケージとして公開し、`opencode.json` / `tui.json` の `plugin` フィールドで読み込む。
- npm パッケージ名は `@yohi/sibyl` とする。`oh-my-openagent` の Tmux コアは実装の参考・比較対象であり、`sibyl` プラグインはこれに依存しない。新しい OpenTUI 版バックエンドを `sibyl` プラグインとして提供し、概念上は Tmux 実装と差し替え可能な I/F を設計する。

### 1.2 技術選定（確認済み）

| レイヤー | 採用技術 |
| :--- | :--- |
| プラグイン API | `@opencode-ai/plugin/tui` |
| TUI レンダリング | `@opentui/core` + `@opentui/solid` |
| PTY プロセス | `node-pty`（v1.1.0 基準） |
| 初期表示方式 | 最小限方式：PTY 出力を ANSI strip して `TextRenderable` に表示 |
| 将来拡張 | ANSI 解釈方式、さらに OpenTUI ネイティブのセルマトリクス方式 |

---

## 2. 所見と改善提案

### 2.1 プラグイン API の記述が不足

#### 現状

要件書は「OpenCode のプラグインとして設計する」と述べているが、具体的なエントリポイント、`package.json` の `exports`、TUI plugin の利用方法が記載されていない。

#### 問題

読者（実装者）がどのファイルを作り、どの API で登録すればよいか分からない。特に `action-executor.ts` の `spawnTmuxPane` をどう置き換えるかが、フェーズ3まで先送りになっている。

#### 提案

以下のコンポーネントを設計段階で明確化する。

- `PaneBackend` 抽象：ペイン生成・リサイズ・入力・終了の共通 I/F
- `TmuxPaneBackend`：既存 `@oh-my-opencode/tmux-core` を使う実装
- `OpenTuiPaneBackend`：新しい OpenTUI + PTY 実装
- `LayoutManager`：ペイン分割・フォーカス・クローズを管理
- `PtyManager`：PTY プロセスのライフサイクルを一元管理

### 2.2 PTY 出力を「text-buffer.ts」へリアルタイム同期する記述は不正確

#### 現状

要件書は「OpenTUI の描画バッファ（`text-buffer.ts`）へリアルタイムに同期・描画」としている。

#### 問題

`text-buffer.ts` は内部的な行バッファ実装であり、直接アプリケーションコードが append する対象ではない。誤用するとメモリ管理や描画更新の責務が混在する。

#### 提案

- 初期実装では `ScrollBoxRenderable`（Solid JSX では `<scrollbox>`）の子として `TextRenderable` を配置し、PTY 出力を `content` に反映する。
- 将来的には、PTY 出力を直接 Zig 側に書き込む専用 `TerminalPane` renderable を新設する（セルマトリクス方式）。

### 2.3 `useKeyboard` を用いた入力ルーティングは競合リスクがある

#### 現状

要件書は「OpenTUI の `useKeyboard` を利用し、特定ペインがアクティブな場合の入力をインターセプトする」としている。

#### 問題

`useKeyboard` は `CliRenderer.keyInput` に対してグローバルにリスナーを登録する。複数ペインがある場合、フォーカス外ペインへの入力漏洩や、OpenCode 本体の `api.keymap` との競合が起こりうる。

#### 提案

- ペインフォーカスは Solid signal で一元管理する。
- フォーカス中のペインだけが `useKeyboard` コールバック内で `terminal.write()` を呼び出す。
- ペイン操作系キー（分割・移動・閉じる）は `api.keymap.registerLayer()` で登録し、PTY 入力ハンドラとは分離する。

### 2.4 クリーンアップの記述が抽象的

#### 現状

要件書は「メインプロセスの `SIGINT` や `EXIT` イベント発生時にすべての起動中 PTY を一括クリーンアップする」としている。

#### 問題

OpenCode プラグインとして `process.on("SIGINT")` を多用すると、ホストのシグナルハンドリングと競合する。`process.exit()` 内の非同期クリーンアップは Node.js では実行保証がない。

#### 提案

- 主体となるクリーンアップは OpenCode の標準 hook に統合する。
  - Server plugin 側: `dispose()` hook
  - TUI plugin 側: `api.lifecycle.onDispose()`
- 最後の fallback としてのみ `process.once("exit")` で `terminal.kill()` を行う。
- PTY 停止は POSIX では SIGTERM → 1.5秒 timeout → SIGKILL、Windows では `terminal.kill()` とプラットフォーム分岐する。

### 2.5 非機能要件「50ms以内」は測定方法が不明確

#### 現状

「プロセスの出力が 50ms 以内に TUI 描画バッファへ反映され」とある。

#### 問題

計測起点が定義されていない（PTY 受信時？ バッファ書き込み時？ 実際の画面描画時？）。

#### 提案

目標を以下のように具体化する。

- フェーズ1: PTY `onData` イベント発火から OpenTUI 表示更新が1フレーム内（≒ 16ms）であること。
- 運用目標: ユーザー体感遅延が 50ms 以下であること（スクロール含む）。

### 2.6 移行ロードマップの抽象度が不均一

#### 現状

フェーズ1〜2は PoC 的で具体性があるが、フェーズ3は「`spawnTmuxPane` 等のインターフェースを抽象化する」に留まっている。

#### 問題

何をどのファイルに実装するのか不明。結果として、フェーズ3が重い「ブラックボックス」になってしまう。

#### 提案

フェーズ3の成果物を具体的なクラス・ファイルに分解する。

| ファイル | 責務 |
| :--- | :--- |
| `src/pane-backend.ts` | `PaneBackend` 抽象 I/F |
| `src/tmux-pane-backend.ts` | Tmux 版実装 |
| `src/opentui-pane-backend.ts` | OpenTUI 版実装 |
| `src/pty-manager.ts` | `node-pty` プロセス管理 |
| `src/layout-manager.ts` | ペイン分割・フォーカス・クローズ |

### 2.7 `node-pty` のネイティブ依存と Bun 実行環境の懸念

#### 現状

`node-pty` はネイティブ addon を含む。OpenCode は Bun ランタイムで動作する可能性がある。

#### 問題

Bun で `node-pty` の prebuilt binary が正しく動作する保証がない。実行時に `dlopen` エラーが起きるリスクがある。

#### 提案

- 初期実装では `node-pty` を使うが、Bun 互換テストを CI に入れる。
- 必要に応じて `bun-pty` または自前 PTY wrapper へのフォールバックを設計し、実行時にランタイムを判定して切り替える。

### 2.8 ANSI エスケープの取り扱いが要件書にない

#### 現状

要件書では Tmux 側の「ANSI パースミス」を課題として挙げているが、OpenTUI 側でどう扱うかが未定義。

#### 問題

PTY 出力を `TextRenderable.content` にそのまま流すと、ANSI コードが可視化されて正しいターミナル表示にならない。

#### 提案

以下のロードマップを明示する。

1. **フェーズ1（最小限方式）**: ANSI コードを strip または簡易忽略してテキスト表示。
2. **フェーズ2（ANSI 解釈方式）**: `xterm-headless` や同等のライブラリで仮想画面を解釈し、色やカーソル移動を OpenTUI 上で再現。
3. **フェーズ3（セルマトリクス方式）**: OpenTUI のネイティブ Zig レイヤに直接セル状態を書き込む専用 renderable を新規開発。これが将来的な最終形。

---

## 3. 設計上の推奨アーキテクチャ

```text
┌─────────────────────────────────────┐
│  OpenCode CLI / TUI                 │
│  ├─ opencode.json plugin load       │
│  └─ tui.json plugin load            │
├─────────────────────────────────────┤
│  Sibyl Plugin                       │
│  ├─ src/server.ts                   │
│  │   └─ command registration via    │
│  │      config / command.execute.before│
│  ├─ src/tui.tsx                     │
│  │   ├─ api.route.register("sibyl") │
│  │   ├─ api.keymap.registerLayer()  │
│  │   └─ api.lifecycle.onDispose()   │
│  ├─ src/layout-manager.tsx           │
│  ├─ src/pane.tsx                     │
│  ├─ src/pty-manager.ts               │
│  ├─ src/pane-backend.ts              │
│  ├─ src/tmux-pane-backend.ts         │
│  └─ src/opentui-pane-backend.ts      │
├─────────────────────────────────────┤
│  node-pty                            │
│  └─ PTY spawned subprocesses         │
└─────────────────────────────────────┘
```

### 3.1 主要コンポーネントの責務

| コンポーネント | 責務 |
| :--- | :--- |
| `PtyManager` | `node-pty` の起動、終了、リサイズ、PID 管理、ゾンビ防止 |
| `LayoutManager` | ペインの生成、分割、フォーカス移動、クローズ |
| `Pane` | 1つのペインに対応する Solid コンポーネント。`ScrollBox` + `TextRenderable` + フォーカス状態 |
| `PaneBackend` | ペインをどの技術で実現するかの抽象 I/F |
| `TmuxPaneBackend` | Tmux 版実装（既存互換） |
| `OpenTuiPaneBackend` | OpenTUI + PTY 版実装（新規） |

### 3.2 クリーンアップフロー

```text
running
  ├─ pane close / SIGTERM
  │     ├─ exited ──► dispose renderable / dispose PTY subscription
  │     └─ timeout 1.5s ──► SIGKILL ──► dispose
  └─ host dispose hook
        └─ all PTYs ──► SIGTERM ──► timeout ──► SIGKILL
```

---

## 4. リスクと対応

| リスク | 影響 | 対応 |
| :--- | :--- | :--- |
| `node-pty` が Bun で動かない | プラグインが起動しない | CI で Bun テスト。必要なら `bun-pty` 等へのフォールバック設計。 |
| OpenTUI API の破壊的変更 | プラグインが動作不良 | peer dependency で `>=0.4.5 <1` 等の上限を設ける。 |
| 大量の ANSI 出力で描画遅延 | 非機能要件未達 | 初期は strip、将来的に NativeSpanFeed / セルマトリクス方式へ移行。 |
| キー入力のホストとの競合 | 操作性低下 | `api.keymap` と `useKeyboard` の責務を分離。 |
| 子孫プロセスのゾンビ化 | リソース漏洩 | `PtyManager` で PID ツリー監視、プロセスグループ kill も検討。 |

---

## 5. 結論

要件定義書の方向性は妥当である。ただし、実装に進むには以下を行う必要がある。

1. プラグイン API（`@opencode-ai/plugin/tui`）を活用したエントリ構成を確定する。
2. `PaneBackend` 抽象を早期に導入し、Tmux/OpenTUI 実装を差し替え可能にする。
3. PTY 出力の表示方式を「最小限方式 → ANSI 解釈方式 → セルマトリクス方式」のロードマップで明示する。
4. クリーンアップを OpenCode の標準 dispose hook に統合し、プラットフォーム分岐した終了処理を実装する。
5. 非機能目標の測定起点を定義する。

次工程は、本レビューで確定した方針に基づく**詳細実装計画**の作成である。
