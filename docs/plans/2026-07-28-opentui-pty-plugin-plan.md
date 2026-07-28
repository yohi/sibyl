# Sibyl: OpenTUI + PTY マルチペインプラグイン 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenCode プラグインとして、Tmux に依存しないマルチペイン環境を OpenTUI + `node-pty` で実現し、npm パッケージとして公開可能な状態にする。

**Architecture:** Solid JSX を使った TUI route 内に動的ペインレイアウトを構築し、各ペインを `node-pty` で起動したサブプロセスに紐づける。ペインの生成・分割・フォーカス・クローズは `LayoutManager` で管理し、PTY のライフサイクルは `PtyManager` で一元管理する。`oh-my-openagent` の Tmux コアは参考・比較対象であり依存しないが、概念上の Tmux 版実装との差し替えを可能にするため、ペイン実装は `PaneBackend` 抽象の背後に隠蔽する。

**Tech Stack:** TypeScript, Solid JSX (`@opentui/solid`), `@opentui/core`, `node-pty`, `@opencode-ai/plugin/tui`, Bun（OpenCode 準拠）

## Global Constraints

- `package.json` は `"type": "module"` とし、ルート import 用の `exports["."]` と `exports["./server"]` / `exports["./tui"]` を提供する。
- OpenCode engine: `^1.18.8` 以上。
- OpenTUI peer dependencies: `@opentui/core`, `@opentui/solid`, `@opentui/keymap` はすべて `>=0.4.5 <1` とする。
- `@types/bun` と CI の Bun はともに `1.1.17` に固定し、lockfile と合わせて再現可能なビルドにする。
- 絶対パスは使用しない。環境変数または相対パスで解決する。
- 型安全: `as any`, `@ts-ignore`, `@ts-expect-error` は禁止。
- エラーハンドリング: 空の catch ブロックは禁止。
- クリーンアップ: POSIX では SIGTERM → 1.5秒 timeout → SIGKILL。Windows では `terminal.kill()`。
- PTY 出力の表示は初期実装で ANSI strip / 簡易表示とし、将来の ANSI 解釈方式・セルマトリクス方式への進化を明示する。

---

## File Structure

| ファイル | 責務 |
| :--- | :--- |
| `package.json` | npm パッケージ設定、exports、peer dependencies |
| `tsconfig.json` | TypeScript 設定、Solid JSX コンパイル |
| `src/server.ts` | Server plugin：command 登録、session event cleanup |
| `src/tui.tsx` | TUI plugin：route / keymap / lifecycle 登録、Sibyl 画面の root |
| `src/types.ts` | プラグイン内で使う共通型（PaneId, SplitDirection, PtyOptions 等） |
| `src/pty-manager.ts` | `node-pty` の起動・終了・リサイズ・イベント購読管理 |
| `src/layout-manager.tsx` | ペインの生成・分割・フォーカス・クローズ、レイアウト状態 |
| `src/pane.tsx` | 1ペインを表す Solid コンポーネント |
| `src/pane-backend.ts` | `PaneBackend` 抽象インターフェース |
| `src/opentui-pane-backend.ts` | OpenTUI + PTY 版の `PaneBackend` 実装 |
| `src/ansi-strip.ts` | 簡易 ANSI strip / 制御コード除去 |
| `tests/pty-manager.test.ts` | `PtyManager` の単体テスト |
| `tests/layout-manager.test.tsx` | `LayoutManager` + `Pane` のテスト |
| `tests/opentui-pane-backend.test.ts` | OpenTUI 版バックエンドのテスト |
| `tests/ansi-strip.test.ts` | ANSI strip のテスト |
| `.github/workflows/ci.yml` | CI：build, lint, test |

`TmuxPaneBackend` は Sibyl 本体には作成しない。必要な場合は `PaneBackend` を実装する別パッケージまたは外部アダプターとして提供する。

---

## Task 1: プロジェクトセットアップ

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/index.ts`（ルート export と空でない初回ビルド用）
- Modify: `README.md`（既存の簡易内容を拡張）

**Interfaces:**
- Consumes: なし
- Produces: プロジェクトのビルド・テスト基盤

- [ ] **Step 1: package.json を作成する**

```json
{
  "name": "@yohi/sibyl",
  "version": "0.1.0",
  "description": "OpenTUI + PTY multi-pane plugin for OpenCode",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./server": {
      "types": "./dist/server.d.ts",
      "import": "./dist/server.js"
    },
    "./tui": {
      "types": "./dist/tui.d.ts",
      "import": "./dist/tui.js"
    }
  },
  "scripts": {
    "build": "tsc --emitDeclarationOnly && rollup -c",
    "build:types": "tsc --emitDeclarationOnly",
    "test": "bun test",
    "lint": "biome check .",
    "lint:fix": "biome check --write ."
  },
  "engines": {
    "opencode": "^1.18.8"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": "^1.18.8",
    "@opentui/core": ">=0.4.5 <1",
    "@opentui/keymap": ">=0.4.5 <1",
    "@opentui/solid": ">=0.4.5 <1"
  },
  "optionalDependencies": {
    "node-pty": "^1.1.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@rollup/plugin-babel": "^6.0.4",
    "@rollup/plugin-node-resolve": "^15.3.0",
    "@types/bun": "1.1.17",
    "babel-preset-solid": "^1.9.3",
    "rollup": "^4.28.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: tsconfig.json を作成する**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid",
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

`jsx: "preserve"` は型検査・宣言出力のために維持する。一方、公開用 JavaScript は JSX を実行できる形へ変換しなければならないため、`build` では `rollup` + `babel-preset-solid`（または同等の Solid JSX 対応 bundler）による Solid JSX 変換ステップを必ず実行する。`dist/tui.js` が生成されることを build 確認の受入条件に含める。

- [ ] **Step 1.5: `rollup.config.js` と `babel.config.json` を作成する**

```js
// rollup.config.js
import { nodeResolve } from "@rollup/plugin-node-resolve"
import babel from "@rollup/plugin-babel"

const extensions = [".ts", ".tsx"]

export default [
  {
    input: "src/index.ts",
    output: { file: "dist/index.js", format: "esm" },
    external: [/^@opencode-ai/, /^@opentui/, "node-pty"],
    plugins: [nodeResolve({ extensions }), babel({ extensions, babelHelpers: "bundled" })],
  },
  {
    input: "src/server.ts",
    output: { file: "dist/server.js", format: "esm" },
    external: [/^@opencode-ai/, /^@opentui/, "node-pty"],
    plugins: [nodeResolve({ extensions }), babel({ extensions, babelHelpers: "bundled" })],
  },
  {
    input: "src/tui.tsx",
    output: { file: "dist/tui.js", format: "esm" },
    external: [/^@opencode-ai/, /^@opentui/, "node-pty"],
    plugins: [nodeResolve({ extensions }), babel({ extensions, babelHelpers: "bundled" })],
  },
]

// babel.config.json
// { "presets": ["solid", "@babel/preset-typescript"] }
```

- [ ] **Step 3: tsconfig.json を作成する**
- [ ] **Step 4: .gitignore を作成する**

```gitignore
node_modules/
dist/
*.log
.DS_Store
.env
```

- [ ] **Step 5: README.md を更新する**

既存の README に以下を追記する。

````markdown
## Development

```bash
bun install
bun run build
bun test
```
````

- [ ] **Step 6: 依存関係をインストールしビルドが通ることを確認する**

Run: `bun install`
Expected: `node_modules/` と `bun.lock` が作成される。先に最小の `src/index.ts` を `export {}` として作成し、空の `include` による `tsc` エラーを避ける。`src/server.ts` / `src/tui.tsx` を build entry に含める完全な `bun run build` の確認は、両ファイルを追加した Task 6 の Step 4 へ移動する。

- [ ] **Step 7: Commit**

git add package.json tsconfig.json rollup.config.js babel.config.json .gitignore src/index.ts README.md bun.lock
git commit -m "chore: プロジェクトセットアップ"
```

---

## Task 2: 共通型定義と ANSI strip

**Files:**
- Create: `src/types.ts`
- Create: `src/ansi-strip.ts`
- Create: `tests/ansi-strip.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `PaneId`, `SplitDirection`, `PtyOptions`, `AnsiStripResult`, `stripAnsi(text)`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// tests/ansi-strip.test.ts
import { describe, expect, test } from "bun:test"
import { stripAnsi } from "../src/ansi-strip"

describe("stripAnsi", () => {
  test("removes color SGR sequences", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red")
  })

  test("removes cursor movement sequences", () => {
    expect(stripAnsi("\x1b[2Kline")).toBe("line")
  })

  test("removes BEL-terminated OSC titles", () => {
    expect(stripAnsi("\x1b]0;Sibyl\x07ready")).toBe("ready")
  })

  test("removes ST-terminated OSC hyperlinks while preserving their label", () => {
    expect(stripAnsi("\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\")).toBe("link")
  })

  test("removes an OSC sequence split across received chunks after buffering", () => {
    const chunks = ["before\x1b]0;title", "\x07after"]
    expect(stripAnsi(chunks.join(""))).toBe("beforeafter")
  })

  test("keeps plain text", () => {
    expect(stripAnsi("hello")).toBe("hello")
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test tests/ansi-strip.test.ts`
Expected: `stripAnsi` が未定義で FAIL。

- [ ] **Step 3: 最小限の実装を書く**

```ts
// src/types.ts
export type PaneId = string

export type SplitDirection = "horizontal" | "vertical"

export interface PtyOptions {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string | undefined>
  cols?: number
  rows?: number
}

export interface PaneModel {
  id: PaneId
  direction?: SplitDirection
  children?: PaneModel[]
  ptyOptions?: PtyOptions
}
```

```ts
// src/ansi-strip.ts
const OSC_PATTERN = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g
const ANSI_PATTERN =
  /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\]|\^[\\@A-Z[\]^_`a-z{|}~]|_[\\\\]^_`a-z{|}~]|\*|[\x80-\x9f])/g

export function stripAnsi(text: string): string {
  return text.replace(OSC_PATTERN, "").replace(ANSI_PATTERN, "")
}
```

`stripAnsi` は完結した文字列を処理する純粋関数とする。PTY の分割チャンクでは、`Pane` 側が未完了の OSC（`ESC ]` から BEL または ST まで）を次チャンクと結合してから渡す。上記テストはその境界を含む入力を検証する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test tests/ansi-strip.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/ansi-strip.ts tests/ansi-strip.test.ts
git commit -m "feat: 共通型とANSI stripを追加"
```

---

## Task 3: PtyManager（node-pty ラッパー）

**Files:**
- Create: `src/pty-manager.ts`
- Create: `tests/pty-manager.test.ts`

**Interfaces:**
- Consumes: `PtyOptions` from `src/types.ts`
- Produces: `PtyManager` class with `spawn`, `write`, `resize`, `terminate`, `onData`, `onExit`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// tests/pty-manager.test.ts
import { describe, expect, test } from "bun:test"
import { PtyManager } from "../src/pty-manager"

describe("PtyManager", () => {
  test("spawns a shell and receives data", async () => {
    const manager = new PtyManager()
    const shell = process.platform === "win32" ? "cmd.exe" : "bash"
    const pty = await manager.spawn({ command: shell, args: [], cols: 80, rows: 24 })

    const dataPromise = new Promise<string>((resolve) => {
      pty.onData((data) => {
        if (data.length > 0) resolve(data)
      })
    })

    pty.write("echo hello\r")
    const data = await dataPromise
    expect(data).toContain("hello")

    await manager.terminate(pty.id)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test tests/pty-manager.test.ts`
Expected: `PtyManager` 未定義で FAIL。

- [ ] **Step 3: 最小限の実装を書く**

```ts
// src/pty-manager.ts
import type { IPty } from "node-pty"
import type { PtyOptions } from "./types.js"

export type PtyId = string

export interface PtyHandle {
  id: PtyId
  write(data: string): void
  resize(cols: number, rows: number): void
  onData(callback: (data: string) => void): () => void
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): () => void
}

export class PtyManager {
  private terminals = new Map<PtyId, IPty>()
  private dataSubscriptions = new Map<PtyId, ReturnType<IPty["onData"]>>()
  private exitSubscriptions = new Map<PtyId, ReturnType<IPty["onExit"]>>()
  private dataCallbacks = new Map<PtyId, Set<(data: string) => void>>()
  private exitCallbacks = new Map<
    PtyId,
    Set<(event: { exitCode: number; signal?: number }) => void>
  >()
  private exited = new Set<PtyId>()
  private idCounter = 0
  private nodePtyModule?: Promise<typeof import("node-pty")>

  constructor(
    private readonly loadBunPtyAdapter?: () => Promise<typeof import("node-pty")>,
    private readonly loadNodePty = () => import("node-pty"),
  ) {}

  async spawn(options: PtyOptions): Promise<PtyHandle> {
    const id = `pty-${++this.idCounter}`
    const { spawn } = await this.loadPtyModule()
    const terminal = spawn(options.command, options.args, {
      name: "xterm-256color",
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cwd: options.cwd ?? process.cwd(),
      env: {
        ...process.env,
        TERM: "xterm-256color",
        ...options.env,
      },
      encoding: "utf8",
    })

    this.terminals.set(id, terminal)

    const dataSub = terminal.onData((data) => {
      if (!this.exited.has(id)) {
        this.emitData(id, data)
      }
    })
    this.dataSubscriptions.set(id, dataSub)

    const exitSub = terminal.onExit((event) => {
      this.exited.add(id)
      this.emitExit(id, event)
    })
    this.exitSubscriptions.set(id, exitSub)

    return this.createHandle(id, terminal)
  }

  async terminate(id: PtyId, gracefulTimeoutMs = 1500): Promise<void> {
    const terminal = this.terminals.get(id)
    if (!terminal) {
      this.dispose(id)
      return
    }

    let resolveExit = () => {}
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    let exitListener: ReturnType<IPty["onExit"]> | undefined
    exitListener = terminal.onExit(() => {
      exitListener?.dispose()
      resolveExit()
    })

    // onExit を先に登録する。すでに終了済みなら待機せずに解決する。
    if (this.exited.has(id)) {
      exitListener?.dispose()
      resolveExit()
      await exitPromise
      this.dispose(id)
      return
    }

    if (process.platform === "win32") {
      terminal.kill()
    } else {
      terminal.kill("SIGTERM")

      await Promise.race([
        exitPromise,
        new Promise<void>((resolve) => setTimeout(resolve, gracefulTimeoutMs)),
      ])

      if (!this.exited.has(id)) {
        terminal.kill("SIGKILL")
      }
    }

    await exitPromise
    this.dispose(id)
  }

  terminateAll(): Promise<void> {
    const promises = Array.from(this.terminals.keys()).map((id) => this.terminate(id))
    return Promise.all(promises).then(() => undefined)
  }

  private emitData(_id: PtyId, _data: string): void {
    for (const callback of this.dataCallbacks.get(_id) ?? []) {
      callback(_data)
    }
  }

  private emitExit(_id: PtyId, _event: { exitCode: number; signal?: number }): void {
    for (const callback of this.exitCallbacks.get(_id) ?? []) {
      callback(_event)
    }
  }

  private createHandle(id: PtyId, terminal: IPty): PtyHandle {
    return {
      id,
      write: (data) => terminal.write(data),
      resize: (cols, rows) => {
        if (cols > 0 && rows > 0 && !this.exited.has(id)) {
          try {
            terminal.resize(cols, rows)
          } catch (error) {
            if (!this.exited.has(id)) {
              throw error
            }
          }
        }
      },
      onData: (callback) => {
        const callbacks =
          this.dataCallbacks.get(id) ?? new Set<(data: string) => void>()
        callbacks.add(callback)
        this.dataCallbacks.set(id, callbacks)
        return () => {
          callbacks.delete(callback)
          if (callbacks.size === 0) {
            this.dataCallbacks.delete(id)
          }
        }
      },
      onExit: (callback) => {
        const callbacks =
          this.exitCallbacks.get(id) ??
          new Set<(event: { exitCode: number; signal?: number }) => void>()
        callbacks.add(callback)
        this.exitCallbacks.set(id, callbacks)
        return () => {
          callbacks.delete(callback)
          if (callbacks.size === 0) {
            this.exitCallbacks.delete(id)
          }
        }
      },
    }
  }

  private dispose(id: PtyId): void {
    this.dataSubscriptions.get(id)?.dispose()
    this.exitSubscriptions.get(id)?.dispose()
    this.dataSubscriptions.delete(id)
    this.exitSubscriptions.delete(id)
    this.dataCallbacks.delete(id)
    this.exitCallbacks.delete(id)
    this.terminals.delete(id)
    this.exited.delete(id)
  }

  private async loadPtyModule(): Promise<typeof import("node-pty")> {
    if (typeof process.versions.bun === "string" && this.loadBunPtyAdapter) {
      return this.loadBunPtyAdapter()
    }
    this.nodePtyModule ??= this.loadNodePty().catch((error: unknown) => {
      throw new Error("No compatible PTY adapter is available", { cause: error })
    })
    return this.nodePtyModule
  }
}
```

`node-pty` は optional dependency であるため、静的 runtime import は禁止する。`PtyManager` はランタイムを判定してから `import("node-pty")`（または Bun 用の注入済みアダプター）を選択し、失敗時は利用可能な PTY アダプターを案内するエラーを返す。`spawn()` はこのロードを await するため非同期 API とし、呼び出し側も await する。イベント配送は `Map<PtyId, Set<callback>>` で実装済みとし、複数 handle・複数購読者でも独立して通知する。

**Task 3 完成時の条件:** `PtyManager` は非同期の spawn / write / resize / terminate / イベント購読を実装する。`node-pty` はランタイム判定後にのみ動的ロードし、複数 PTY・複数購読者のデータ／終了イベントを `Map<PtyId, Set<callback>>` で正しく配送する。終了済み PTY の `terminate()` は exit listener を登録した後に即時 resolve し、待機しない。Task 8 の実レンダリングテストでは 2 ペイン同時起動・出力受信・終了通知も検証する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test tests/pty-manager.test.ts`
Expected: PASS（`bash` が利用可能な環境で）。

- [ ] **Step 5: Commit**

```bash
git add src/pty-manager.ts tests/pty-manager.test.ts
git commit -m "feat: PtyManagerを追加"
```

---

## Task 4: PaneBackend 抽象と OpenTUI 版実装

**Files:**
- Create: `src/pane-backend.ts`
- Create: `src/opentui-pane-backend.ts`
- Create: `tests/opentui-pane-backend.test.ts`

**Interfaces:**
- Consumes: `PtyManager`, `stripAnsi`, `PtyOptions`
- Produces: `PaneBackend` interface, `OpenTuiPaneBackend`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// tests/opentui-pane-backend.test.ts
import { describe, expect, test } from "bun:test"
import { OpenTuiPaneBackend } from "../src/opentui-pane-backend"

describe("OpenTuiPaneBackend", () => {
  test("returns a pane model with PTY options", () => {
    const backend = new OpenTuiPaneBackend()
    const pane = backend.create({
      command: "bash",
      args: [],
      cols: 80,
      rows: 24,
    })

    expect(pane.ptyOptions).toEqual({
      command: "bash",
      args: [],
      cols: 80,
      rows: 24,
    })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test tests/opentui-pane-backend.test.ts`
Expected: FAIL（クラス未定義）。

- [ ] **Step 3: 最小限の実装を書く**

```ts
// src/pane-backend.ts
import type { PaneModel, PtyOptions } from "./types.js"

export interface PaneBackend {
  create(options: PtyOptions): PaneModel
}
```

```ts
// src/opentui-pane-backend.ts
import type { PaneBackend } from "./pane-backend.js"
import type { PaneModel, PtyOptions } from "./types.js"

let idCounter = 0

export class OpenTuiPaneBackend implements PaneBackend {
  create(options: PtyOptions): PaneModel {
    return {
      id: `opentui-pane-${++idCounter}`,
      ptyOptions: options,
    }
  }
}
```

Tmux 実装の stub は作成しない。`TmuxPaneBackend` が必要な利用者は、Sibyl が公開する `PaneBackend` interface を実装する外部アダプターまたは別パッケージとして提供する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test tests/opentui-pane-backend.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/pane-backend.ts src/opentui-pane-backend.ts tests/opentui-pane-backend.test.ts
git commit -m "feat: PaneBackend抽象とOpenTUI実装を追加"
```

---

## Task 5: LayoutManager + Pane コンポーネント

**Files:**
- Create: `src/layout-manager.tsx`
- Create: `src/pane.tsx`
- Create: `tests/layout-manager.test.tsx`

**Interfaces:**
- Consumes: `PaneModel`, `PaneBackend`, `PtyManager`, `stripAnsi`, `useKeyboard`
- Produces: `LayoutManager` component, `Pane` component, `createStore` helpers

- [ ] **Step 1: 失敗するテストを書く**

```tsx
// tests/layout-manager.test.tsx
import { describe, expect, test } from "bun:test"
import { Pane } from "../src/pane"

describe("Pane", () => {
  test("renders with title", () => {
    // 実際のレンダリングテストは OpenTUI test renderer が必要。
    // 初期は型レベルと props 検証に留める。
    expect(typeof Pane).toBe("function")
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test tests/layout-manager.test.tsx`
Expected: FAIL（`Pane` 未定義）。

- [ ] **Step 3: 最小限の実装を書く**

```tsx
// src/pane.tsx
/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { PaneModel } from "./types.js"
import type { PtyHandle, PtyId, PtyManager } from "./pty-manager.js"
import { stripAnsi } from "./ansi-strip.js"

export interface PaneProps {
  model: PaneModel
  ptyManager: PtyManager
  focused: boolean
  onFocus: () => void
  onPtyReady: (paneId: string, ptyId: PtyId) => void
  cols: number
  rows: number
}

export function Pane(props: PaneProps) {
  const MAX_OUTPUT_LINES = 1000
  const [output, setOutput] = createSignal("")
  let ptyHandle: PtyHandle | undefined
  let disposed = false
  let pendingOsc = ""
  let removeDataListener = () => {}
  let removeExitListener = () => {}

  const appendOutput = (data: string) => {
    const raw = pendingOsc + data
    const lastOscStart = raw.lastIndexOf("\x1b]")
    const lastOsc = lastOscStart === -1 ? "" : raw.slice(lastOscStart)
    const isIncompleteOsc =
      lastOscStart !== -1 && !/(?:\x07|\x1b\\)/.test(lastOsc)
    const complete = isIncompleteOsc ? raw.slice(0, lastOscStart) : raw
    pendingOsc = isIncompleteOsc ? lastOsc : ""
    setOutput((previous) => {
      const lines = `${previous}${stripAnsi(complete)}`.split(/\r?\n/)
      return lines.slice(-MAX_OUTPUT_LINES).join("\n")
    })
  }

  onMount(() => {
    if (!props.model.ptyOptions) return
    void props.ptyManager
      .spawn(props.model.ptyOptions)
      .then((handle) => {
        if (disposed) {
          void props.ptyManager.terminate(handle.id)
          return
        }
        ptyHandle = handle
        props.onPtyReady(props.model.id, handle.id)
        removeDataListener = handle.onData(appendOutput)
        removeExitListener = handle.onExit(() => {
          removeDataListener()
          removeExitListener()
        })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        appendOutput(`PTY start failed: ${message}\n`)
      })
  })

  onCleanup(() => {
    disposed = true
    removeDataListener()
    removeExitListener()
  })

  useKeyboard((e) => {
    if (!props.focused || !ptyHandle) return
    ptyHandle.write(e.sequence ?? e.raw ?? e.name)
  })

  return (
    <box
      flexGrow={1}
      border={true}
      borderStyle="single"
      onClick={props.onFocus}
      focusable={true}
    >
      <scrollbox flexGrow={1}>
        <text content={output()} />
      </scrollbox>
    </box>
  )
}
```

```tsx
// src/layout-manager.tsx
/** @jsxImportSource @opentui/solid */
import { createSignal, For } from "solid-js"
import type { PaneModel, SplitDirection } from "./types.js"
import type { PtyId, PtyManager } from "./pty-manager.js"
import { Pane } from "./pane.js"

export interface LayoutManagerProps {
  ptyManager: PtyManager
  initialPanes: PaneModel[]
}

export function LayoutManager(props: LayoutManagerProps) {
  const [panes, setPanes] = createSignal(props.initialPanes)
  const [focusedId, setFocusedId] = createSignal<string | undefined>(
    props.initialPanes[0]?.id,
  )
  const ptyIdsByPane = new Map<string, PtyId>()

  const splitPane = (id: string, direction: SplitDirection) => {
    setPanes((prev) => addPaneAt(prev, id, direction))
  }

  const closePane = async (id: string) => {
    const ptyId = ptyIdsByPane.get(id)
    if (ptyId) {
      await props.ptyManager.terminate(ptyId)
      ptyIdsByPane.delete(id)
    }
    const nextPanes = panes().filter((pane) => pane.id !== id)
    setPanes(nextPanes)
    setFocusedId((focused) => (focused === id ? nextPanes[0]?.id : focused))
  }

  return (
    <box flexDirection="row" flexGrow={1} width="100%" height="100%">
      <For each={panes()}>
        {(pane) => (
          <Pane
            model={pane}
            ptyManager={props.ptyManager}
            focused={focusedId() === pane.id}
            onFocus={() => setFocusedId(pane.id)}
            onPtyReady={(paneId, ptyId) => ptyIdsByPane.set(paneId, ptyId)}
            cols={80}
            rows={24}
          />
        )}
      </For>
    </box>
  )
}

function addPaneAt(
  panes: PaneModel[],
  _targetId: string,
  _direction: SplitDirection,
): PaneModel[] {
  // 初期は単純 append。再帰的レイアウトツリー対応は Task 6 で拡張。
  return [...panes]
}
```

`Pane` の表示出力は最大 1000 行の bounded buffer とし、超過した先頭行を破棄する。`onCleanup` は購読解除だけを同期的に行い、PTY を終了しない。ペイン操作や UI の close 要求は親の `LayoutManager.closePane()` に集約し、`PtyManager.terminate()` を await してから PaneModel を状態から除去する。Task 9 ではこの close 処理を再帰ツリーに拡張する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test tests/layout-manager.test.tsx`
Expected: PASS（型・コンポーネント存在確認レベル）。

- [ ] **Step 5: Commit**

```bash
git add src/layout-manager.tsx src/pane.tsx tests/layout-manager.test.tsx
git commit -m "feat: LayoutManagerとPaneコンポーネントを追加"
```

---

## Task 6: TUI plugin エントリ（tui.tsx）

**Files:**
- Create: `src/tui.tsx`

**Interfaces:**
- Consumes: `LayoutManager`, `PtyManager`, `api.route`, `api.keymap`, `api.lifecycle`
- Produces: TUI plugin default export

- [ ] **Step 1: 失敗するテストを書く**

```ts
// tests/tui.test.ts
import { describe, expect, test } from "bun:test"
import plugin from "../src/tui"

describe("TUI plugin", () => {
  test("exports default plugin object", () => {
    expect(plugin).toHaveProperty("id")
    expect(plugin).toHaveProperty("tui")
    expect(typeof plugin.tui).toBe("function")
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test tests/tui.test.ts`
Expected: FAIL（`src/tui.tsx` 未定義）。

- [ ] **Step 3: 最小限の実装を書く**

```tsx
// src/tui.tsx
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { LayoutManager } from "./layout-manager.js"
import { PtyManager } from "./pty-manager.js"
import { OpenTuiPaneBackend } from "./opentui-pane-backend.js"

const tui: TuiPlugin = async (api) => {
  // node-pty は静的 import しない。PtyManager がランタイム判定後にこの
  // loader を呼び、Bun 用アダプターがあればそれを優先する。
  const ptyManager = new PtyManager(undefined, () => import("node-pty"))
  const backend = new OpenTuiPaneBackend()

  api.route.register([
    {
      name: "sibyl",
      render: () => (
        <LayoutManager
          ptyManager={ptyManager}
          initialPanes={[
            backend.create({
              command: process.platform === "win32" ? "cmd.exe" : process.env.SHELL || "sh",
              args: [],
              cols: 80,
              rows: 24,
            }),
          ]}
        />
    },
  ])

  api.keymap.registerLayer({
    commands: [
      {
        name: "sibyl.open",
        title: "Open Sibyl",
        category: "Plugin",
        namespace: "palette",
        slashName: "sibyl",
        run() {
          api.route.navigate("sibyl")
        },
      },
    ],
    bindings: [
      {
        key: "ctrl+shift+s",
        cmd: "sibyl.open",
        desc: "Open Sibyl multi-pane console",
      },
    ],
  })

  api.lifecycle.onDispose(async () => {
    await ptyManager.terminateAll()
  })
}

const plugin: TuiPluginModule = {
  id: "oh-my-opencode.sibyl",
  tui,
}

export default plugin
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test tests/tui.test.ts`
Expected: PASS。続けて `bun run build` を実行し、JSX 変換済みの `dist/tui.js` が存在することを確認する（例: `bun -e 'import { existsSync } from "node:fs"; if (!existsSync("dist/tui.js")) process.exit(1)'`）。

- [ ] **Step 5: Commit**

```bash
git add src/tui.tsx tests/tui.test.ts
git commit -m "feat: TUI pluginエントリを追加"
```

---

## Task 7: Server plugin エントリ（server.ts）

**Files:**
- Create: `src/server.ts`

**Interfaces:**
- Consumes: `@opencode-ai/plugin` API
- Produces: Server plugin default export

- [ ] **Step 1: 失敗するテストを書く**

```ts
// tests/server.test.ts
import { describe, expect, test } from "bun:test"
import plugin from "../src/server"

describe("Server plugin", () => {
  test("exports default plugin object", () => {
    expect(plugin).toHaveProperty("id")
    expect(plugin).toHaveProperty("server")
    expect(typeof plugin.server).toBe("function")
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test tests/server.test.ts`
Expected: FAIL（`src/server.ts` 未定義）。

- [ ] **Step 3: 最小限の実装を書く**

```ts
// src/server.ts
import type { Plugin, PluginModule } from "@opencode-ai/plugin"

const server: Plugin = async () => {
  return {
    config: async (config) => {
      config.command ??= {}
      config.command.sibyl = {
        template: "Open the Sibyl multi-pane console",
        description: "Open Sibyl",
      }
    },
    "command.execute.before": async (input) => {
      if (input.command !== "sibyl") return
      // TUI plugin 側の route "sibyl" を開く処理は host 側でハンドルする。
      // Server plugin からは navigation を直接行わない。
    },
  }
}

const plugin: PluginModule = {
  id: "oh-my-opencode.sibyl",
  server,
}

export default plugin
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test tests/server.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/server.test.ts
git commit -m "feat: Server pluginエントリを追加"
```

---

## Task 8: 再帰的レイアウトツリー（横縦分割）

**Files:**
- Modify: `src/layout-manager.tsx`
- Modify: `src/pane.tsx`
- Modify: `tests/layout-manager.test.tsx`

**Interfaces:**
- Consumes: `PaneModel.children`, `SplitDirection`
- Produces: 入れ子の `LayoutManager` / `Pane`

- [ ] **Step 1: 失敗するテストを書く**

```tsx
// tests/layout-manager.test.tsx（追記）
test("nested panes render as horizontal children and route focus", () => {
  const tree: PaneModel = {
    id: "root",
    direction: "horizontal",
    children: [
      { id: "left", ptyOptions: { command: "bash", args: [] } },
      { id: "right", ptyOptions: { command: "bash", args: [] } },
    ],
  }

  const view = renderOpenTui(
    <LayoutManager model={tree} ptyManager={fakePtyManager} />,
  )

  expect(view.panes()).toHaveLength(2)
  expect(view.focusedPaneId()).toBe("left")
  expect(view.layoutFor(tree.id)).toHaveProperty("flexDirection", "row")
})
```

`renderOpenTui` は採用した OpenTUI バージョンの test renderer を使うテスト helper とする。`PaneModel` の shape だけを検査するテストは削除し、`LayoutManager` と `Pane` を実際にレンダリングして、入れ子方向・フォーカス表示・PTY の `spawn` / `onData` / `onExit` 購読・close 要求を検証する。少なくとも 2 ペイン同時起動時に、各ペインの出力と終了通知が相互に混線しないことを含める。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test tests/layout-manager.test.tsx`
Expected: FAIL（`LayoutManager` が tree 構造に未対応）。

- [ ] **Step 3: 実装を修正する**

```tsx
// src/layout-manager.tsx（再帰対応版）
/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show } from "solid-js"
import type { PaneModel } from "./types.js"
import type { PtyId, PtyManager } from "./pty-manager.js"
import { Pane } from "./pane.js"

export interface LayoutManagerProps {
  ptyManager: PtyManager
  model: PaneModel
  initialFocusedId?: string
}

export function LayoutManager(props: LayoutManagerProps) {
  const [model, setModel] = createSignal(props.model)
  const [focusedId, setFocusedId] = createSignal(
    props.initialFocusedId ?? firstLeafId(props.model),
  )
  const ptyIdsByPane = new Map<string, PtyId>()

  return (
    <LayoutNode
      model={model()}
      ptyManager={props.ptyManager}
      focusedId={focusedId()}
      onFocus={setFocusedId}
      onPtyReady={(paneId, ptyId) => ptyIdsByPane.set(paneId, ptyId)}
    />
  )
}

interface LayoutNodeProps {
  model: PaneModel
  ptyManager: PtyManager
  focusedId: string | undefined
  onFocus: (id: string) => void
  onPtyReady: (paneId: string, ptyId: PtyId) => void
}

function LayoutNode(props: LayoutNodeProps) {

  return (
    <Show
      when={props.model.children}
      fallback={
        <Pane
          model={props.model}
          ptyManager={props.ptyManager}
          focused={props.focusedId === props.model.id}
          onFocus={() => props.onFocus(props.model.id)}
          onPtyReady={props.onPtyReady}
          cols={80}
          rows={24}
        />
      }
    >
      {(children) => (
        <box
          flexDirection={
            props.model.direction === "vertical" ? "column" : "row"
          }
          flexGrow={1}
          width="100%"
          height="100%"
        >
          <For each={children()}>
            {(child) => (
              <LayoutNode
                model={child}
                ptyManager={props.ptyManager}
                focusedId={props.focusedId}
                onFocus={props.onFocus}
                onPtyReady={props.onPtyReady}
              />
            )}
          </For>
        </box>
      )}
    </Show>
  )
}

function firstLeafId(model: PaneModel): string | undefined {
  if (!model.children?.length) return model.id
  return firstLeafId(model.children[0])
}
```

`model` と `focusedId` の signal は root の `LayoutManager` だけが保持する。Task 9 の操作 command はこの root state の `setModel` と `setFocusedId` を更新し、子 `LayoutNode` は受け取った props だけで描画する。

`tui.tsx` の `initialPanes` プロパティを `model` に変更する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test tests/layout-manager.test.tsx`
Expected: PASS。Step 3 の実装とともに、以下の実レンダリングテストケースを追加すること:

- フォーカス移動: root の単一 signal で明示的な pane id にフォーカスを設定し、子 `LayoutNode` へ props として伝播すること。
- クローズ: `LayoutManager` が `closePane` を await した後に親ツリーから該当ペインを除去すること。
- PTY 接続: `Pane` コンポーネントが `ptyManager.spawn()` して生成した `PtyHandle` を保持し、`onData` イベントを購読して状態更新すること。

これらのテストは Task 9 のフォーカス制御・分割処理と合わせて `tests/layout-manager.test.tsx` / `tests/pane.test.tsx` に追加する。各再帰ノードでローカル signal を初期化してはならない。

Run: `bun test tests/layout-manager.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/layout-manager.tsx src/pane.tsx src/tui.tsx tests/layout-manager.test.tsx
git commit -m "feat: 再帰的な横縦分割レイアウトを追加"
```

---

## Task 9: キーマップとフォーカス制御

**Files:**
- Modify: `src/tui.tsx`
- Modify: `src/layout-manager.tsx`
- Create: `src/keymap.ts`

**Interfaces:**
- Consumes: `api.keymap`, `LayoutManager` state
- Produces: pane split / focus / close commands と、close 時の PTY 終了・代替フォーカス選択

- [ ] **Step 1: 失敗するテストを書く**

```ts
// tests/keymap.test.ts
import { describe, expect, test } from "bun:test"
import { closePane, splitPane } from "../src/keymap"

describe("keymap helpers", () => {
  test("splits a leaf pane horizontally", () => {
    const tree = { id: "root", ptyOptions: { command: "bash", args: [] } }
    const next = splitPane(tree, "root", "horizontal", { command: "bash", args: [] })
    expect(next.children).toHaveLength(2)
    expect(next.direction).toBe("horizontal")
    expect(next.id).not.toBe("root")
    expect(next.children?.[0]?.id).toBe("root")
  })

  test("terminates and removes a leaf, then focuses a remaining pane", async () => {
    const tree = {
      id: "split-1",
      direction: "horizontal" as const,
      children: [
        { id: "left", ptyOptions: { command: "bash", args: [] } },
        { id: "right", ptyOptions: { command: "bash", args: [] } },
      ],
    }
    const terminated: string[] = []

    const result = await closePane(tree, "left", async (leaf) => {
      terminated.push(leaf.id)
    })

    expect(terminated).toEqual(["left"])
    expect(result.root?.id).toBe("right")
    expect(result.focusedId).toBe("right")
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test tests/keymap.test.ts`
Expected: FAIL（`src/keymap.ts` 未定義）。

- [ ] **Step 3: 実装を書く**

```ts
// src/keymap.ts
import type { PaneModel, PtyOptions, SplitDirection } from "./types.js"

let idCounter = 0

export function splitPane(
  root: PaneModel,
  targetId: string,
  direction: SplitDirection,
  newPtyOptions: PtyOptions,
): PaneModel {
  const usedIds = new Set(collectNodes(root).map((node) => node.id))
  return splitPaneAt(root, targetId, direction, newPtyOptions, usedIds)
}

function splitPaneAt(
  root: PaneModel,
  targetId: string,
  direction: SplitDirection,
  newPtyOptions: PtyOptions,
  usedIds: Set<string>,
): PaneModel {
  if (root.id === targetId && !root.children) {
    return {
      // Internal node には leaf と別の ID を割り当て、既存 leaf の ID を保持する。
      id: nextUniqueId(usedIds, "split"),
      direction,
      children: [
        { id: root.id, ptyOptions: root.ptyOptions },
        { id: nextUniqueId(usedIds, "pane"), ptyOptions: newPtyOptions },
      ],
    }
  }

  if (!root.children) return root

  return {
    ...root,
    children: root.children.map((child) =>
      splitPaneAt(child, targetId, direction, newPtyOptions, usedIds),
    ),
  }
}

export interface ClosePaneResult {
  root: PaneModel | undefined
  focusedId: string | undefined
}

export async function closePane(
  root: PaneModel,
  targetId: string,
  terminateLeaf: (leaf: PaneModel) => Promise<void>,
): Promise<ClosePaneResult> {
  const leaves = collectLeaves(root)
  const targetIndex = leaves.findIndex((leaf) => leaf.id === targetId)
  const target = leaves[targetIndex]
  if (!target) {
    return { root, focusedId: undefined }
  }

  await terminateLeaf(target)
  const nextRoot = removeLeaf(root, targetId)
  const nextLeaves = nextRoot ? collectLeaves(nextRoot) : []
  const focusedId = nextLeaves[Math.min(targetIndex, nextLeaves.length - 1)]?.id
  return { root: nextRoot, focusedId }
}

export function findPane(root: PaneModel, id: string): PaneModel | undefined {
  if (root.id === id) return root
  if (!root.children) return undefined
  for (const child of root.children) {
    const found = findPane(child, id)
    if (found) return found
  }
  return undefined
}

export function nextLeaf(root: PaneModel, currentId: string): string | undefined {
  const leaves = collectLeaves(root)
  const idx = leaves.findIndex((p) => p.id === currentId)
  if (idx === -1 || idx === leaves.length - 1) return leaves[0]?.id
  return leaves[idx + 1]?.id
}

export function prevLeaf(root: PaneModel, currentId: string): string | undefined {
  const leaves = collectLeaves(root)
  const idx = leaves.findIndex((p) => p.id === currentId)
  if (idx <= 0) return leaves[leaves.length - 1]?.id
  return leaves[idx - 1]?.id
}

function collectLeaves(root: PaneModel): PaneModel[] {
  if (!root.children) return [root]
  return root.children.flatMap(collectLeaves)
}

function removeLeaf(root: PaneModel, targetId: string): PaneModel | undefined {
  if (!root.children) return root.id === targetId ? undefined : root

  const children = root.children
    .map((child) => removeLeaf(child, targetId))
    .filter((child): child is PaneModel => child !== undefined)
  if (children.length === 0) return undefined
  if (children.length === 1) return children[0]
  return { ...root, children }
}

function collectNodes(root: PaneModel): PaneModel[] {
  return [root, ...(root.children?.flatMap(collectNodes) ?? [])]
}

function nextUniqueId(usedIds: Set<string>, prefix: string): string {
  let id = ""
  do {
    id = `${prefix}-${++idCounter}`
  } while (usedIds.has(id))
  usedIds.add(id)
  return id
}
```

`tui.tsx` にペイン操作 command を追加する。close command は `closePane()` に、対象 leaf に対応する `PtyManager.terminate()` を await するコールバックを渡す。戻った tree と `focusedId` を root の `LayoutManager` state にまとめて反映し、PTY 終了前に PaneModel を削除しない。

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test tests/keymap.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/keymap.ts tests/keymap.test.ts src/tui.tsx src/layout-manager.tsx
git commit -m "feat: ペイン分割・フォーカス・クローズのキーマップを追加"
```

---

## Task 10: リサイズ対応と pty サイズ同期

**Files:**
- Modify: `src/pane.tsx`
- Modify: `src/layout-manager.tsx`
- Modify: `src/pty-manager.ts`

**Interfaces:**
- Consumes: OpenTUI `useTerminalDimensions`
- Produces: PTY `resize(cols, rows)` calls

- [ ] **Step 1: 失敗するテストを書く**

```ts
// tests/pty-manager.test.ts（追記）
test("resize validates dimensions", async () => {
  const manager = new PtyManager()
  const shell = process.platform === "win32" ? "cmd.exe" : "bash"
  const pty = await manager.spawn({ command: shell, args: [], cols: 80, rows: 24 })
  expect(() => pty.resize(0, 0)).not.toThrow()
  await manager.terminate(pty.id)
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test tests/pty-manager.test.ts`
Expected: FAIL（`resize` が 0,0 を防いでいない場合は通るが、実装意図に応じて修正）。

- [ ] **Step 3: 実装を修正する**

`src/pane.tsx` ではサイズ取得を OpenTUI の `useTerminalDimensions` に統一する。terminal width は `cols`、height は `rows` として整数化し、いずれも正の値のときだけ `ptyHandle.resize(cols, rows)` を呼ぶ。box ref や `onResize` との混在はしない。

簡易実装例:

```tsx
// src/pane.tsx に追加
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect } from "solid-js"

const terminalDimensions = useTerminalDimensions()

createEffect(() => {
  const { width, height } = terminalDimensions()
  const cols = Math.floor(width)
  const rows = Math.floor(height)
  if (ptyHandle && cols > 0 && rows > 0) {
    ptyHandle.resize(cols, rows)
  }
})
```

- [ ] **Step 4: テストを確認する**

Run: `bun test tests/pty-manager.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/pane.tsx src/layout-manager.tsx src/pty-manager.ts tests/pty-manager.test.ts
git commit -m "feat: ペインリサイズをPTYサイズと同期"
```

---

## Task 11: Biome 設定と CI

**Files:**
- Create: `biome.json`
- Create: `.github/workflows/ci.yml`
- Commit: `bun.lock`（`bun install` が生成する lockfile）

**Interfaces:**
- Consumes: プロジェクト全体
- Produces: lint / format / test の自動実行

- [ ] **Step 1: biome.json を作成する**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  }
}
```

- [ ] **Step 2: CI workflow を作成する**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.1.17"
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run build
      - run: bun test
```

- [ ] **Step 3: lockfile を含めて lint と build を実行して通ることを確認する**

Run: `bun run lint:fix && bun run build && bun test`
Expected: `bun.lock` をコミット対象に含めたうえで、ubuntu-latest / macos-latest / windows-latest の OS matrix すべてで PASS。`node-pty` の native addon が各 OS の Bun で利用できない場合は、Task 3 の動的アダプター選択と診断エラーを検証し、静的 import に戻さない。

- [ ] **Step 4: Commit**

```bash
git add biome.json .github/workflows/ci.yml bun.lock
git commit -m "chore: Biome設定とCIを追加"
```

---

## Task 12: ドキュメントと将来ロードマップ

**Files:**
- Create: `docs/architecture.md`
- Modify: `README.md`
- Modify: `REQUIREMENTS.md`（必要に応じて参照追記）

**Interfaces:**
- Consumes: 実装済みコンポーネント
- Produces: 利用者・開発者向けドキュメント

- [ ] **Step 1: architecture.md を作成する**

```markdown
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
```

- [ ] **Step 2: README.md に利用方法を追記する**

````markdown
## Installation

```json
{
  "plugin": ["@yohi/sibyl"]
}
```

## Usage

OpenCode TUI 内で `ctrl+shift+s` または command palette から `sibyl.open` を実行する。
````

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md README.md
git commit -m "docs: アーキテクチャと利用方法を追加"
```

---

## Self-Review

### Spec coverage

- F1 動的レイアウト分割: Task 5 / Task 8 で対応。
- F2 PTY インテグレーション: Task 3 / Task 10 で対応。
- F3 入力イベントルーティング: Task 5 / Task 9 で対応。
- F4 ライフサイクルとクリーンアップ: Task 3 / Task 6 / Task 10 で対応。
- 非機能要件: Task 1 / Task 11（CI）、Task 10（リサイズ）で対応。

### Placeholder scan

- 計画内に "TBD", "TODO" は含めていない。
- `addPaneAt` の初期実装は append のみだが、Task 9 で `splitPane` による再帰的 split に置き換える。
- サイズ取得は Task 10 で `useTerminalDimensions` に統一し、width を cols、height を rows として PTY に同期する。

### Type consistency

- `PaneId` / `PtyId` / `string` の使い分けに注意。`focusedId` は `string` として統一。
- `PtyHandle.onData` / `onExit` の戻り値は unsubscribe 関数。

### 既知の課題

- `PtyManager` の `emitData` / `emitExit` は Task 3 で `Map<PtyId, Set<callback>>` による複数 handle・複数購読者対応を実装する。
- `node-pty` の Bun 互換性は CI（Task 11）で検証する。
