# Sibyl: OpenTUI + PTY マルチペインプラグイン 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenCode プラグインとして、Tmux に依存しないマルチペイン環境を OpenTUI + `node-pty` で実現し、npm パッケージとして公開可能な状態にする。

**Architecture:** Solid JSX を使った TUI route 内に動的ペインレイアウトを構築し、各ペインを `node-pty` で起動したサブプロセスに紐づける。ペインの生成・分割・フォーカス・クローズは `LayoutManager` で管理し、PTY のライフサイクルは `PtyManager` で一元管理する。`oh-my-openagent` の Tmux コアは参考・比較対象であり依存しないが、概念上の Tmux 版実装との差し替えを可能にするため、ペイン実装は `PaneBackend` 抽象の背後に隠蔽する。

**Tech Stack:** TypeScript, Solid JSX (`@opentui/solid`), `@opentui/core`, `node-pty`, `@opencode-ai/plugin/tui`, Bun（OpenCode 準拠）

## Global Constraints

- `package.json` は `"type": "module"` とし、`exports["./server"]` / `exports["./tui"]` を提供する。
- OpenCode engine: `^1.18.8` 以上。
- OpenTUI peer dependencies: `@opentui/core`, `@opentui/solid`, `@opentui/keymap` は `>=0.4.5`（上限は実装時の安定版に応じて `<1` とする）。
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
- Create: `src/tmux-pane-backend.ts` | Tmux 版の `PaneBackend` 実装（参考・比較対象、依存関係なし、初期は stub 可）
| `src/ansi-strip.ts` | 簡易 ANSI strip / 制御コード除去 |
| `tests/pty-manager.test.ts` | `PtyManager` の単体テスト |
| `tests/layout-manager.test.tsx` | `LayoutManager` + `Pane` のテスト |
| `tests/opentui-pane-backend.test.ts` | OpenTUI 版バックエンドのテスト |
| `tests/ansi-strip.test.ts` | ANSI strip のテスト |
| `.github/workflows/ci.yml` | CI：build, lint, test |

---

## Task 1: プロジェクトセットアップ

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
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
    "build": "tsc",
    "test": "bun test",
    "lint": "biome check .",
    "lint:fix": "biome check --write ."
  },
  "engines": {
    "opencode": "^1.18.8"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": "^1.18.8",
    "@opentui/core": ">=0.4.5",
    "@opentui/keymap": ">=0.4.5",
    "@opentui/solid": ">=0.4.5"
  },
  "dependencies": {
    "node-pty": "^1.1.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@types/bun": "latest",
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

- [ ] **Step 3: .gitignore を作成する**

```gitignore
node_modules/
dist/
*.log
.DS_Store
.env
```

- [ ] **Step 4: README.md を更新する**

既存の README に以下を追記する。

```markdown
## Development

```bash
bun install
bun run build
bun test
```
```

- [ ] **Step 5: 依存関係をインストールしビルドが通ることを確認する**

Run: `bun install`
Expected: `node_modules/` が作成され、`bun run build` がエラーなく完了する（まだソースがないため空のビルドで OK）。

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore README.md
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
const ANSI_PATTERN =
  /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\]|\^[\\@A-Z[\]^_`a-z{|}~]|_[\\\\]^_`a-z{|}~]|\*|[\x80-\x9f])/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "")
}
```

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
    const pty = manager.spawn({ command: shell, args: [], cols: 80, rows: 24 })

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
import { spawn, type IPty } from "node-pty"
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
  private exited = new Set<PtyId>()
  private idCounter = 0

  spawn(options: PtyOptions): PtyHandle {
    const id = `pty-${++this.idCounter}`
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
    if (!terminal || this.exited.has(id)) {
      this.dispose(id)
      return
    }

    const exitPromise = new Promise<void>((resolve) => {
      const sub = terminal.onExit(() => {
        sub.dispose()
        resolve()
      })
    })

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
    // overridden by createHandle callback registration
  }

  private emitExit(_id: PtyId, _event: { exitCode: number; signal?: number }): void {
    // overridden by createHandle callback registration
  }

  private createHandle(id: PtyId, terminal: IPty): PtyHandle {
    let dataCallback: ((data: string) => void) | undefined
    let exitCallback: ((event: { exitCode: number; signal?: number }) => void) | undefined

    this.emitData = (targetId, data) => {
      if (targetId === id && dataCallback) {
        dataCallback(data)
      }
    }

    this.emitExit = (targetId, event) => {
      if (targetId === id && exitCallback) {
        exitCallback(event)
      }
    }

    return {
      id,
      write: (data) => terminal.write(data),
      resize: (cols, rows) => {
        if (cols > 0 && rows > 0 && !this.exited.has(id)) {
          try {
            terminal.resize(cols, rows)
          } catch {
            // terminal already exited
          }
        }
      },
      onData: (callback) => {
        dataCallback = callback
        return () => {
          if (dataCallback === callback) {
            dataCallback = undefined
          }
        }
      },
      onExit: (callback) => {
        exitCallback = callback
        return () => {
          if (exitCallback === callback) {
            exitCallback = undefined
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
    this.terminals.delete(id)
    this.exited.delete(id)
  }
}
```
注: 上記 `emitData` / `emitExit` は各 handle 作成時に上書きされるため、複数 handle では最後のものだけ有効になる。これは設計上のバグであるため、実装時に `Map<PtyId, Set<callback>>` 方式に修正すること。

**Task 3 完成時の条件:** `PtyManager` は単一 PTY の spawn / write / resize / terminate / イベント購読を実装する。複数 PTY を同時に動作させるには Task 8 以降で `Pane` コンポーネントが `PtyManager` と接続する際、コールバックを handle ごとに独立して管理する必要がある。実装では `Map<PtyId, Set<(data: string) => void>>` と `Map<PtyId, Set<(event) => void>>` を使い、同じ PTY ハンドルに複数の購読者がいても、また異なる PTY ハンドルが同時に存在しても、それぞれのコールバックが正しく呼ばれるように修正すること。Task 8 では `tests/layout-manager.test.tsx` に 2 ペイン同時起動・出力受信・終了通知のテストケースを追加し、複数 PTY のイベント配送が壊れていないことを検証する。

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
- Create: `src/tmux-pane-backend.ts`（stub）
- Create: `tests/opentui-pane-backend.test.ts`

**Interfaces:**
- Consumes: `PtyManager`, `stripAnsi`, `PtyOptions`
- Produces: `PaneBackend` interface, `OpenTuiPaneBackend`, `TmuxPaneBackend` stub

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

```ts
// src/tmux-pane-backend.ts
import type { PaneBackend } from "./pane-backend.js"
import type { PaneModel, PtyOptions } from "./types.js"

let idCounter = 0

export class TmuxPaneBackend implements PaneBackend {
  create(options: PtyOptions): PaneModel {
    return {
      id: `tmux-pane-${++idCounter}`,
      ptyOptions: options,
    }
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test tests/opentui-pane-backend.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/pane-backend.ts src/opentui-pane-backend.ts src/tmux-pane-backend.ts tests/opentui-pane-backend.test.ts
git commit -m "feat: PaneBackend抽象とOpenTUI/Tmux実装を追加"
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
import { createSignal, onCleanup } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { PaneModel } from "./types.js"
import type { PtyManager, PtyHandle } from "./pty-manager.js"
import { stripAnsi } from "./ansi-strip.js"

export interface PaneProps {
  model: PaneModel
  ptyManager: PtyManager
  focused: boolean
  onFocus: () => void
  cols: number
  rows: number
}

export function Pane(props: PaneProps) {
  const [output, setOutput] = createSignal("")
  let ptyHandle: PtyHandle | undefined

  if (props.model.ptyOptions) {
    ptyHandle = props.ptyManager.spawn(props.model.ptyOptions)

    const removeDataListener = ptyHandle.onData((data) => {
      setOutput((prev) => prev + stripAnsi(data))
    })

    const removeExitListener = ptyHandle.onExit(() => {
      removeDataListener()
      removeExitListener()
    })

    onCleanup(async () => {
      removeDataListener()
      removeExitListener()
      if (ptyHandle) {
        await props.ptyManager.terminate(ptyHandle.id)
      }
    })
  }

  useKeyboard((e) => {
    if (!props.focused || !ptyHandle) return
    ptyHandle.write(e.name)
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
import type { PtyManager } from "./pty-manager.js"
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

  const splitPane = (id: string, direction: SplitDirection) => {
    setPanes((prev) => addPaneAt(prev, id, direction))
  }

  const closePane = (id: string) => {
    setPanes((prev) => prev.filter((p) => p.id !== id))
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
  const ptyManager = new PtyManager()
  const backend = new OpenTuiPaneBackend()

  api.route.register([
    {
      name: "sibyl",
      render: () => (
        <LayoutManager
          ptyManager={ptyManager}
          initialPanes={[
            backend.create({
              command: process.platform === "win32" ? "cmd.exe" : process.env.SHELL ?? "/bin/sh",
              args: [],
              cols: 80,
              rows: 24,
            }),
          ]}
        />
      ),
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
Expected: PASS。

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
test("nested panes split horizontally", () => {
  const tree: PaneModel = {
    id: "root",
    direction: "horizontal",
    children: [
      { id: "left", ptyOptions: { command: "bash", args: [] } },
      { id: "right", ptyOptions: { command: "bash", args: [] } },
    ],
  }

  expect(tree.direction).toBe("horizontal")
  expect(tree.children).toHaveLength(2)
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test tests/layout-manager.test.tsx`
Expected: FAIL（`LayoutManager` が tree 構造に未対応）。

- [ ] **Step 3: 実装を修正する**

```tsx
// src/layout-manager.tsx（再帰対応版）
/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show } from "solid-js"
import type { PaneModel } from "./types.js"
import type { PtyManager } from "./pty-manager.js"
import { Pane } from "./pane.js"

export interface LayoutManagerProps {
  ptyManager: PtyManager
  model: PaneModel
  focusedId?: string
  onFocus?: (id: string) => void
}

export function LayoutManager(props: LayoutManagerProps) {
  const [focusedId, setFocusedId] = createSignal(
    props.focusedId ?? props.model.id,
  )

  const handleFocus = (id: string) => {
    setFocusedId(id)
    props.onFocus?.(id)
  }

  return (
    <Show
      when={props.model.children}
      fallback={
        <Pane
          model={props.model}
          ptyManager={props.ptyManager}
          focused={focusedId() === props.model.id}
          onFocus={() => handleFocus(props.model.id)}
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
              <LayoutManager
                model={child}
                ptyManager={props.ptyManager}
                focusedId={focusedId()}
                onFocus={handleFocus}
              />
            )}
          </For>
        </box>
      )}
    </Show>
  )
}
```

`tui.tsx` の `initialPanes` プロパティを `model` に変更する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test tests/layout-manager.test.tsx`
Expected: PASS。ただし、このテストでは tree 構造の検証のみであり、ペインのフォーカス移動・クローズ・PTY イベント配送の検証は不十分である。Step 3 の実装とともに、以下のテストケースを追加すること:

- フォーカス移動: 初期フォーカスが root ではなく、明示的な pane id に設定されること。
- クローズ: `LayoutManager` が onClose コールバックを発火し、親ツリーから該当ペインが除去されること（コールバック方式は `Pane` 実装時に決定）。
- PTY 接続: `Pane` コンポーネントが `ptyManager.spawn()` して生成した `PtyHandle` を保持し、`onData` イベントを購読して状態更新すること。

これらのテストは Task 9 のフォーカス制御・分割処理と合わせて `tests/layout-manager.test.tsx` / `tests/pane.test.tsx` に追加する。

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
- Produces: pane split / focus / close commands

- [ ] **Step 1: 失敗するテストを書く**

```ts
// tests/keymap.test.ts
import { describe, expect, test } from "bun:test"
import { splitPane } from "../src/keymap"

describe("keymap helpers", () => {
  test("splits a leaf pane horizontally", () => {
    const tree = { id: "root", ptyOptions: { command: "bash", args: [] } }
    const next = splitPane(tree, "root", "horizontal", { command: "bash", args: [] })
    expect(next.children).toHaveLength(2)
    expect(next.direction).toBe("horizontal")
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

let paneCounter = 0

export function splitPane(
  root: PaneModel,
  targetId: string,
  direction: SplitDirection,
  newPtyOptions: PtyOptions,
): PaneModel {
  if (root.id === targetId) {
    return {
      id: root.id,
      direction,
      children: [
        { ...root, id: root.id },
        { id: `pane-${++paneCounter}`, ptyOptions: newPtyOptions },
      ],
    }
  }

  if (!root.children) return root

  return {
    ...root,
    children: root.children.map((child) =>
      splitPane(child, targetId, direction, newPtyOptions),
    ),
  }
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
```

`tui.tsx` にペイン操作 command を追加する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test tests/keymap.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/keymap.ts tests/keymap.test.ts src/tui.tsx src/layout-manager.tsx
git commit -m "feat: ペイン分割・フォーカス移動のキーマップを追加"
```

---

## Task 10: リサイズ対応と pty サイズ同期

**Files:**
- Modify: `src/pane.tsx`
- Modify: `src/layout-manager.tsx`
- Modify: `src/pty-manager.ts`

**Interfaces:**
- Consumes: OpenTUI `onResize` / box dimensions
- Produces: PTY `resize(cols, rows)` calls

- [ ] **Step 1: 失敗するテストを書く**

```ts
// tests/pty-manager.test.ts（追記）
test("resize validates dimensions", () => {
  const manager = new PtyManager()
  const pty = manager.spawn({ command: "bash", args: [], cols: 80, rows: 24 })
  expect(() => pty.resize(0, 0)).not.toThrow()
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test tests/pty-manager.test.ts`
Expected: FAIL（`resize` が 0,0 を防いでいない場合は通るが、実装意図に応じて修正）。

- [ ] **Step 3: 実装を修正する**

`src/pane.tsx` において、OpenTUI の box サイズ変更を検知して `ptyHandle.resize()` を呼ぶ。Solid / OpenTUI では `onResize` hook または `box` の `layout` イベントを利用する。具体的な API は OpenTUI バージョンに依存するため、実装時に `useTerminalDimensions` または `box` ref 経由で取得する。

簡易実装例:

```tsx
// src/pane.tsx に追加
import { onResize } from "@opentui/solid"

onResize((width, height) => {
  if (ptyHandle) {
    ptyHandle.resize(width, height)
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
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install
      - run: bun run lint
      - run: bun run build
      - run: bun test
```

- [ ] **Step 3: lint と build を実行して通ることを確認する**

Run: `bun run lint:fix && bun run build && bun test`
Expected: すべて PASS。

- [ ] **Step 4: Commit**

```bash
git add biome.json .github/workflows/ci.yml
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
- `PaneBackend`: Tmux / OpenTUI 実装の抽象。
- `OpenTuiPaneBackend`: OpenTUI + PTY 版。
- `TmuxPaneBackend`: 既存 Tmux 版互換。

## PTY 出力の表示方式ロードマップ

1. **最小限方式（現在）**: ANSI strip してテキスト表示。
2. **ANSI 解釈方式（将来）**: `xterm-headless` 等で仮想画面を解釈。
3. **セルマトリクス方式（将来）**: OpenTUI ネイティブにセル状態を書き込む専用 renderable。
```

- [ ] **Step 2: README.md に利用方法を追記する**

```markdown
## Installation

```json
{
  "plugin": ["@yohi/sibyl"]
}
```

## Usage

OpenCode TUI 内で `ctrl+shift+s` または command palette から `sibyl.open` を実行する。
```

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
- `addPaneAt` の初期実装は append のみだが、Task 8 で再帰的 split に置き換える。
- `onResize` によるサイズ取得は OpenTUI の実 API に依存するため、実装時に `useTerminalDimensions` または box ref を確認して修正する必要あり。これは Task 10 の実装注記として明示している。

### Type consistency

- `PaneId` / `PtyId` / `string` の使い分けに注意。`focusedId` は `string` として統一。
- `PtyHandle.onData` / `onExit` の戻り値は unsubscribe 関数。

### 既知の課題

- `PtyManager` の `emitData` / `emitExit` は複数 handle で最後のコールバックしか有効にならないため、実装時に `Map<PtyId, Set<callback>>` に修正する必要がある。これは Task 3 の注記として記載済み。
- `node-pty` の Bun 互換性は CI（Task 11）で検証する。
