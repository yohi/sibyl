# Sibyl 仕様書 (SPEC.md)

本ドキュメントは、OpenCode プラグイン `@yohi/sibyl` の機能仕様・アーキテクチャ・動作規則を定義する仕様書です。

---

## 1. 概要とコンセプト

`sibyl` は、OpenCode 環境下で動作するマルチペイン統合コンソールプラグインです。  
外部ツールの Tmux に依存せず、**OpenTUI（Solid.js）** と **PTY (疑似端末)** を用いて単一プロセス内で動的ペイン分割・プロセス管理・TUI 描画を完結させます。

### 主な特徴
- **Tmux 非依存**: 外部コマンド依存を排し、Windows / macOS / Linux および Docker / CI 環境で一貫して動作。
- **OpenCode プラグイン アーキテクチャ**: `@opencode-ai/plugin` (Server) および `@opencode-ai/plugin/tui` (TUI) の拡張 API に完全準拠。
- **堅牢な PTY ライフサイクル**: 子孫プロセスの追跡、SIGTERM → タイムアウト → SIGKILL による段階的終了、OpenCode の `onDispose()` フックとの統合。

Server プラグインは `/sibyl` コマンドを登録する薄いコマンドレジストラです。実際のルート遷移と PTY の所有・終了処理は TUI プラグインが担当し、Server 側の `command.execute.before` はコマンドを横取りせずホストへ委譲します。

---

## 2. システム構成・コンポーネント責務

```text
┌─────────────────────────────────────────────────────────┐
│ OpenCode CLI / TUI Host                                 │
│  ├─ opencode.json (Server Plugin: @yohi/sibyl/server)   │
│  └─ tui.json    (TUI Plugin:    @yohi/sibyl/tui)      │
├─────────────────────────────────────────────────────────┤
│ Sibyl Plugin                                            │
│  ├─ src/server.ts         : コマンドパレット定義・フック  │
│  ├─ src/tui.tsx           : ルート登録・Keymap・Dispose │
│  ├─ src/layout-manager.tsx: 再帰的レイアウトツリー・フォーカス │
│  ├─ src/keymap.ts         : 分割/削除/移動の純粋ツリー操作 │
│  ├─ src/pane.tsx          : ペインコンポーネント (Solid.js) │
│  ├─ src/pty-output-buffer.ts : ANSIパース・境界バッファ   │
│  ├─ src/ansi-strip.ts     : C0/CSI/OSC/DCS 等除去       │
│  ├─ src/pane-backend.ts   : PaneBackend 抽象 I/F         │
│  ├─ src/opentui-pane-backend.ts: OpenTUI 版 PaneBackend  │
│  └─ src/pty-manager.ts    : PTY プロセス管理・マルチプラットフォーム│
├─────────────────────────────────────────────────────────┤
│ PTY Adapters                                            │
│  ├─ Bun.Terminal (Bun / POSIX)                          │
│  └─ node-pty     (Node.js / Bun Windows フォールバック) │
└─────────────────────────────────────────────────────────┘
```

### 主要コンポーネント一覧

| コンポーネント | 責務 |
| :--- | :--- |
| `PtyManager` | PTY アダプターの動的ロード、プロセス生成・入力・リサイズ・終了制御、データ/Exit イベントのリプレイとマルチサンスクリプション配送。 |
| `PtyTerminator` | プラットフォーム別の終了処理（POSIX: SIGTERM → 1.5s 待機 → SIGKILL、Windows: `kill()`）および子孫プロセスの追跡・終了。 |
| `PtyProcessTracker` | PTY から起動された子孫プロセスグループ PID の追跡とゾンビ化防止。 |
| `LayoutManager` / `LayoutNode` | Solid.js による再帰的 Flexbox ペインレイアウトの描画と、アクティブペインのフォーカス管理。 |
| `keymap.ts` | レイアウトツリー（`PaneModel`）の純粋関数操作（`splitPane`, `closePane`, `nextLeaf`, `prevLeaf`, `removeLeaf`）。 |
| `Pane` | 1 つのペインを表示する Solid コンポーネント。キーボード入力の PTY 転送、表示用バッファの維持。 |
| `PtyOutputBuffer` | PTY 出力ストリームのバッファリング。チャンク境界をまたぐ不完全エスケープシーケンスの保持と最大保持行数（デフォルト 1000 行）の管理。 |
| `ansi-strip.ts` | 制御文字（C0 制御文字、DCS/SOS/PM/APC、CSI、OSC）の除去（LF・CR・TAB を除く）。 |
| `PaneBackend` | ペイン生成・入力・リサイズの抽象インターフェース。将来の Terminal 描画方式や別バックエンドとの差し替えを可能にする。 |

---

## 3. 入力制御とキーマップ仕様

### 3.1 キーバインドと命令分離
ペイン操作系キーは `api.keymap.registerLayer()` に登録し、全 binding で **`preventDefault: true`** を明示します。

```typescript
bindings: [
  { key: "ctrl+shift+s", cmd: "sibyl.open",             preventDefault: true },
  { key: "ctrl+a h",     cmd: "sibyl.split.horizontal", preventDefault: true },
  { key: "ctrl+a v",     cmd: "sibyl.split.vertical",   preventDefault: true },
  { key: "ctrl+a n",     cmd: "sibyl.focus.next",        preventDefault: true },
  { key: "ctrl+a p",     cmd: "sibyl.focus.prev",        preventDefault: true },
  { key: "ctrl+a x",     cmd: "sibyl.close",             preventDefault: true },
]
```

### 3.2 入力ルーティング
フォーカス中の `Pane` コンポーネントのみが `useKeyboard` ハンドラ内でアクティブな `PtyHandle.write()` を呼び出します。操作キーが Keymap レイヤーで消費されるため、シェル入力との混線は発生しません。

---

## 4. レイアウトツリーとツリー縮約規則

1. **二分木表現**: レイアウトは内部ノード（`direction: "horizontal" | "vertical"` と `children` を持つ）と葉ノード（`ptyOptions` を持つペイン）による二分木として保持されます。
2. **単一子 split ノードの縮約**: ペイン閉鎖（`closePane`）によって子ノードが 1 つだけになった split ノードは、その唯一の子ノードへと自動縮約（un-wrap）されます。これにより不必要な階層構造の維持を防ぎます。
3. **全ペイン閉鎖時の保護**: 最後の 1 ペインを閉じた場合、自動的に新規のデフォルトシェルペインを再生成してルートに配置します。

---

## 5. PTY ライフサイクルとクリーンアップ

### 5.1 終了処理シーケンス
- **POSIX**:
  1. PTY プロセスおよび子孫プロセスグループへ `SIGTERM` を送信。
  2. 1.5 秒のタイムアウトを待機。
  3. 終了しない場合、`SIGKILL` を送信して強制終了。
- **Windows**: `terminal.kill()` を呼び出し。

### 5.2 クリーンアップフック統合
- **標準フック**: OpenCode TUI プラグインの `api.lifecycle.onDispose()` にて全 PTY を一括終了（`ptyManager.terminateAll()`）。
- **最終フォールバック**: `process.once("exit")` にて未終了 PTY に対する同期的 `SIGKILL` フォールバックを実行。

---

## 6. マルチプラットフォーム & ランタイム仕様

| 環境 | PTY アダプター | 備考 |
| :--- | :--- | :--- |
| **Bun (POSIX)** | `Bun.Terminal` (内蔵) | ネイティブ addon なしで高速動作 |
| **Bun (Windows)** | `node-pty` / 外部 PTY | 動的インポート / 外部フォールバック |
| **Node.js (All OS)** | `node-pty` | optionalDependency として動的インポート |

### 6.1 受入対象

`tmux` がインストールされていない環境で、マルチペイン表示、PTY の起動、入力転送、終了処理を検証します。最低限、次の組み合わせを受入対象とします。

- Windows: PowerShell および cmd の既定 shell
- macOS: zsh の既定 shell
- Linux: bash の既定 shell
- 軽量 Docker イメージ
- Node.js ランタイムおよび Bun ランタイム
- GitHub Actions の `ubuntu-latest`、`macos-latest`、`windows-latest`

`node-pty` のネイティブ addon は、対象 OS と対象ランタイムでビルドおよび動作を確認します。

### 6.2 性能受入条件

PTY の `onData` 発火から OpenTUI の表示バッファ（`TextRenderable.content`）への反映は、目標として 1 フレーム（約 16ms）以内に完了させます。実運用上の受入条件は、スクロールを含む負荷で 100Hz の出力を1000サンプル以上測定し、次を満たすことです。

- p95 が 50ms 以下
- p99 が 100ms 以下

## 7. クリーンアップ責務

- TUI プラグインの `api.lifecycle.onDispose()` を標準経路とし、`ptyManager.terminateAll()` で起動中の全 PTY を終了します。
- Server プラグインは PTY を所有しないため、Server 側に個別の PTY クリーンアップ処理はありません。
- `process.once("exit")` は、通常の非同期終了経路ではなく、未終了 PTY に対する同期的な最終 `SIGKILL` フォールバックとしてのみ使用します。

---

## 8. 移行・将来拡張ロードマップ

1. **フェーズ1：PTY プロトタイプ**: 単一 PTY の出力を `ScrollBox` に表示する。
2. **フェーズ2：入力ルーティング**: フォーカス中の PTY へキーボード入力を転送する。
3. **フェーズ3：レイアウト・バックエンド抽象化**: `PaneBackend` を介して OpenTUI 仮想ペインと外部アダプターを差し替え可能にする。

### 8.1 描画方式

1. **最小限方式 (現在の実装)**: PTY 出力を ANSI strip および制御文字除去の上、`TextRenderable` + `ScrollBox` にて描画。
2. **ANSI 解釈方式 (フェーズ 2)**: `xterm-headless` 等により仮想画面状態を計算し、SGR 色指定やカーソル位置を TUI 上に再構成。
3. **セルマトリクス方式 (フェーズ 3)**: OpenTUI ネイティブ Zig レイヤーに直接セル状態を書き込む専用 `TerminalPane` renderable の開発。
