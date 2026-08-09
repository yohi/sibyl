# Subagent Pane Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically display and manage subagent sessions (spawned by oh-my-openagent etc.) in Sibyl's own OpenTUI-based panes — without tmux — including lifecycle-driven auto-close, pane-count eviction, and SSE reconnect/resync.

**Architecture:** A new `SubagentLifecycleManager` state machine subscribes to OpenCode events (`session.created/idle/error/deleted`) via the in-process `api.event` bus (default) or direct SSE (`api.client.event.subscribe()`), and drives a new `SubagentPaneAdapter`, which spawns `opencode attach` as a PTY through a `PaneBackend`. Configuration is resolved per-field by `ConfigResolver` (env > akane > sibyl). The TUI plugin owns all wiring and disposes everything via `api.lifecycle.onDispose()`.

**Tech Stack:** TypeScript (strict), Solid.js + OpenTUI, Bun (package manager + test runner), Biome (lint/format), `@opencode-ai/plugin@^1.18.8`, `@opencode-ai/sdk@1.18.8`.

**Source spec:** `docs/superpowers/specs/2026-08-09-subagent-pane-integration-design.md`

## Global Constraints

Every task's requirements implicitly include this section. Exact values copied verbatim from the spec (§2/§4/§5/§6).

- **Bun** is the package manager and test runner. Do not use npm/pnpm/yarn.
- **Never suppress type errors**: no `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Let **Biome** enforce style; do not reformat code by hand. Follow existing module patterns.
- Any behavior change must be covered by tests in `tests/`.
- Every spawned PTY must have a guaranteed cleanup path (`PtyTerminator`/`PtyManager`).
- Run `bun run lint`, `bun run typecheck`, and `bun run test` (all green) before each commit.
- Commits: **Conventional Commits in Japanese**.
- Do not commit/push or merge PRs unless explicitly instructed. One PR per phase below (see "PR Splitting".
- No absolute paths (e.g., `/home/...`) in committed files.
- Attach args are `<"opencode"|"opencode.cmd", "attach", serverUrl, "--session", sessionID, "--dir", directory, "--mini">` — `<serverUrl>` first (positional, required), then `--session <id> --dir <directory> --mini` (spec FR-1.4). Shell is never involved (argv array, `shell:false` equivalent).
- `serverUrl` must be `http://` or `https://`; `sessionID` must match `/^[A-Za-z0-9-]+$/` (spec FR-1.4 input validation; reject invalid before attach).
- `maxPanes` valid range is integer 1–8 (default 4). `0` means feature-disabled (close all existing subagent panes; open no more; do not evict). Negative/float/NaN/non-integer at the top-priority source → validation error, NO fallback (spec FR-2.1).
- Credentials never appear in argv or logs: pass via `env.OPENCODE_SERVER_USERNAME`/`env.OPENCODE_SERVER_PASSWORD` only (spec D-9).
- Config precedence is per-field (not per-block): env > akane (`akane.experimental.watchdog.subagentDisplay`) > sibyl (`sibyl.subagentDisplay`); same rule for `serverUrl`/`directory` (spec D-3/D-8).
- Log sanitization: `sessionId` → first 4 chars + `…` (`slice(0,4)+"…"`); error text truncated to 200 chars; raw username/password values never logged (spec §5/§8).

---

## File Structure

New files (one clear responsibility each):

- `src/subagent-validation.ts` — pure validators: `parseMaxPanesValue`, `validateServerUrl`, `validateSessionId`.
- `src/subagent-logger.ts` — `SubagentLogger` interface + pure `sanitizeSessionId` / `truncate` helpers.
- `src/subagent-config.ts` — `ConfigResolver`: `resolveSubagentConfig(options, hostConfig, env)` + `resolveConnection(pluginInput, env)`. Pure, DI-testable.
- `src/subagent-types.ts` — `SubagentLikeSession` (structural subtype of SDK `Session`: `id`,`parentID?`,`time.created`), `SubagentSessionClient` (SDK-client subset), `AttachTarget`, `SubagentPaneManager` interfaces, `SubagentConfig`, `ResolvedConnection`.
- `src/subagent-attach-args.ts` — pure `buildAttachPtyOptions(target, auth, directory)` + `isWindows()`; also (later) `buildSseHeaders`.
- `src/subagent-pane-adapter.ts` — `SubagentPaneAdapter` (implements `SubagentPaneManager`): idempotent open/close, argv-spawn via `PaneBackend`+`PtyManager`.
- `src/subagent-event-source.ts` — `SubagentEventSource` interface, `TuiEventBusSource` (default, wraps `api.event`), `SseEventSource` (wraps `api.client.event.subscribe()`, Authorization header, retry+resync hook).
- `src/subagent-lifecycle-manager.ts` — `SubagentLifecycleManager` state machine: event routing, maxPanes/evict, per-session close-once, async serialization, `session.list()` pull-resync, `stop()` cleanup.
- `src/subagent-integration.ts` — `createDefaultAttachTarget`, `createOpenTuiSubagentPaneManager`, `attachSubagentIntegration(api, options)` — wires the above; returns handle (`enabled`, `stop`, `resyncNow`). Testable per-field without TUI coupling.

Modified files:

- `src/layout-manager.tsx` — add `readonly forceFocus: (id: PaneId) => void` to `LayoutManagerController` (delegates to `setFocusedId`; present but unused at this PR boundary).
- `src/tui.tsx` — feature-flagged wire-up via `attachSubagentIntegration`.
- `src/server.ts` — register `sibyl.toggleSubagentDisplay` command (no-op on server; visible in palette).
- `src/index.ts` — re-export new units for consumers.

Test files mirror the source: `tests/subagent-validation.test.ts`, `tests/subagent-logger.test.ts`, `tests/subagent-config.test.ts`, `tests/subagent-attach-args.test.ts`, `tests/subagent-pane-adapter.test.ts`, `tests/subagent-event-source.test.ts`, `tests/subagent-lifecycle-manager.test.ts`, `tests/subagent-integration.test.ts`. Touch `tests/layout-manager.test.tsx` (forceFocus) and `tests/tui.test.ts` (wire-up) where noted.

---

## PR Splitting

Each phase is one PR (independent source diff):

- **PR A** — Tamari (validation + logging): validation helpers + logger helpers. Pure, no behavior change.
- **PR B** — ConfigResolver: config resolution layer (pure, DI).
- **PR C** — Attach argv builder + `SubagentPaneAdapter` (+ `LayoutManagerController.forceFocus`).
- **PR D** — Event sources (`TuiEventBusSource` default + `SseEventSource` with auth/retry).
- **PR E** — `SubagentLifecycleManager` (state machine, eviction, resync, dispose).
- **PR F** — TUI wiring (`tui.tsx` + `server.ts` toggle) + `attachSubagentIntegration` factory.

PR A → PR F order is a strict dependency chain; open them stacked or sequentially.

---

### Task 1: Validation helpers (PR A)

**Files:**
- Create: `src/subagent-validation.ts`
- Test: `tests/subagent-validation.test.ts`

**Interfaces:**
- Produces (used by Tasks 3/4/6): `export function parseMaxPanesValue(value: unknown): { ok: true; value: number } | { ok: false }`; `export function validateServerUrl(url: string): boolean`; `export function validateSessionId(id: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/subagent-validation.test.ts
import { describe, expect, test } from "bun:test";
import { parseMaxPanesValue, validateServerUrl, validateSessionId } from "../src/subagent-validation";

describe("subagent-validation", () => {
  describe("parseMaxPanesValue (spec FR-2.1)", () => {
    test("0 → ok / value=0 (feature disabled)", () => {
      expect(parseMaxPanesValue(0)).toEqual({ ok: true, value: 0 });
    });
    test("1 and 8 → ok", () => {
      expect(parseMaxPanesValue(1)).toEqual({ ok: true, value: 1 });
      expect(parseMaxPanesValue(8)).toEqual({ ok: true, value: 8 });
    });
    test.each([-1, 2.5, Number.NaN, "4", undefined, null])("%p → not ok", (input) => {
      expect(parseMaxPanesValue(input).ok).toBe(false);
    });
  });

  describe("validateServerUrl", () => {
    test.each([
      ["http://localhost:3000", true],
      ["https://example.com", true],
      ["ftp://example.com", false],
      ["not a url", false],
      ["", false],
    ])("validateServerUrl(%j) === %j", (input, expected) => {
      expect(validateServerUrl(input)).toBe(expected);
    });
  });

  describe("validateSessionId", () => {
    test("alnum+hyphen accepted", () => {
      expect(validateSessionId("abc-123_X".replace("_", ""))).toBe(true); // abc-123X
      expect(validateSessionId("ses_abc".replace("_", "") + "Z")).toBe(true);
    });
    test.each(["", "   ", "a b", "a$b", "a;b", "a`b"])("%j → false", (input) => {
      expect(validateSessionId(input)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/subagent-validation.test.ts`
Expected: FAIL — module not found / functions not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/subagent-validation.ts
export function parseMaxPanesValue(value: unknown): { ok: true; value: number } | { ok: false } {
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false };
  if (!Number.isInteger(value)) return { ok: false };
  if (value < 0) return { ok: false };
  if (value > 8) return { ok: false };
  return { ok: true, value };
}

export function validateServerUrl(url: string): boolean {
  if (url.length === 0) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateSessionId(id: string): boolean {
  if (id.length === 0) return false;
  return /^[A-Za-z0-9-]+$/.test(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/subagent-validation.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Verify gates and commit**

Run: `bun run lint && bun run typecheck && bun test tests/subagent-validation.test.ts`
Expected: all green.

```bash
git add src/subagent-validation.ts tests/subagent-validation.test.ts
git commit -m "feat: サブエージェント統合用のバリデーションヘルパーを追加"
```

---

### Task 2: Sanitized-subagent logger helpers (PR A)

**Files:**
- Create: `src/subagent-logger.ts`
- Test: `tests/subagent-logger.test.ts`

**Interfaces:**
- Produces (used by Tasks 3/4/5/7): `export interface SubagentLogger { info(m: string): void; warn(m: string): void; error(m: string): void; }`; `export const consoleSubagentLogger: SubagentLogger`; `export function sanitizeSessionId(id: string): string`; `export function truncate(text: string, max = 200): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/subagent-logger.test.ts
import { describe, expect, test } from "bun:test";
import { sanitizeSessionId, truncate } from "../src/subagent-logger";

describe("sanitizeSessionId", () => {
  test("masks all but first 4 chars", () => {
    expect(sanitizeSessionId("ses123456789")).toBe("ses1…");
    expect(sanitizeSessionId("abcd")).toBe("abcd…");
    expect(sanitizeSessionId("ab")).toBe("ab…");
  });
});

describe("truncate", () => {
  test("short text unchanged", () => {
    expect(truncate("hello", 200)).toBe("hello");
  });
  test("long text truncated with ellipsis", () => {
    expect(truncate("x".repeat(250), 200)).toBe(`${"x".repeat(200)}...`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/subagent-logger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/subagent-logger.ts
export interface SubagentLogger {
  info(m: string): void;
  warn(m: string): void;
  error(m: string): void;
}

export const consoleSubagentLogger: SubagentLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

export function sanitizeSessionId(id: string): string {
  return `${id.slice(0, 4)}…`;
}

export function truncate(text: string, max = 200): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/subagent-logger.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify gates and commit**

Run: `bun run lint && bun run typecheck && bun test tests/subagent-logger.test.ts`
Expected: all green.

```bash
git add src/subagent-logger.ts tests/subagent-logger.test.ts
git commit -m "feat: サブエージェント用のサニタイズ済みロガーヘルパーを追加"
```

---

### Task 3: ConfigResolver (PR B)

**Files:**
- Create: `src/subagent-config.ts`
- Test: `tests/subagent-config.test.ts`

**Interfaces:**
- Consumes: `parseMaxPanesValue`, `validateServerUrl` (Task 1); `SubagentLogger` (Task 2); SDK `Config` (type only): `import type { Config as SdkConfig } from "@opencode-ai/sdk"`.
- Produces (used by Tasks 4/6/7): `export interface SubagentConfig { enabled: boolean; maxPanes: number }`; `export interface ResolvedConnection { serverUrl: string; directory: string; username?: string | undefined; password?: string | undefined }`; `export function resolveSubagentConfig(args: { pluginOptions?: Record<string, unknown> | undefined; hostConfig: SdkConfig; env: Record<string, string | undefined>; logger: SubagentLogger }): SubagentConfig`; `export function resolveConnection(args: { pluginInput: { serverUrl?: string | undefined; directory?: string | undefined }; env: Record<string, string | undefined>; logger: SubagentLogger }): ResolvedConnection`.

**Behavior contract (spec D-3/D-8/§6.2, FR-2.1):**
For each field (`enabled`, `maxPanes`), pick candidate in order **env → akane → sibyl**; use the *first defined* candidate. If the chosen candidate is invalid → log a sanitize-safe error and throw (no fallback). If no candidate defined → default. `SIBYL_SUBAGENT_ENABLED` env values `"1"/"true"/"yes"` → true, `"0"/"false"/"no"` → false (invalid → treated as defined-invalid → throw). `SIBYL_SUBAGENT_MAX_PANES` is parsed via `Number()` then `parseMaxPanesValue`. akane block: `hostConfig.akane?.experimental?.watchdog?.subagentDisplay`; sibyl block: `hostConfig.sibyl?.subagentDisplay` (read via `unknown` narrowing — `SdkConfig` has no `akane`/`sibyl` index).

- [ ] **Step 1: Write the failing test**

```ts
// tests/subagent-config.test.ts
import { describe, expect, test } from "bun:test";
import { resolveSubagentConfig, resolveConnection } from "../src/subagent-config";
import type { SubagentLogger } from "../src/subagent-logger";

const logger: SubagentLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe("resolveSubagentConfig", () => {
  test("no source → defaults (enabled=false, maxPanes=4)", () => {
    expect(resolveSubagentConfig({ hostConfig: {}, env: {}, logger })).toEqual({
      enabled: false,
      maxPanes: 4,
    });
  });

  test("sibyl block only", () => {
    const hostConfig = { sibyl: { subagentDisplay: { enabled: true, maxPanes: 2 } } } as never;
    expect(resolveSubagentConfig({ hostConfig, env: {}, logger })).toEqual({
      enabled: true,
      maxPanes: 2,
    });
  });

  test("akane beats sibyl per-field; env beats akane per-field", () => {
    const hostConfig = {
      akane: { experimental: { watchdog: { subagentDisplay: { enabled: true, maxPanes: 3 } } } },
      sibyl: { subagentDisplay: { enabled: false, maxPanes: 8 } },
    } as never;
    // env defines only enabled → maxPanes comes from akane
    expect(
      resolveSubagentConfig({ hostConfig, env: { SIBYL_SUBAGENT_ENABLED: "false" }, logger }),
    ).toEqual({ enabled: false, maxPanes: 3 });
  });

  test("pluginOptions are ignored (hostConfig is the source of truth)", () => {
    const pluginOptions = { subagentDisplay: { enabled: true } };
    expect(
      resolveSubagentConfig({ pluginOptions, hostConfig: {}, env: {}, logger }),
    ).toEqual({ enabled: false, maxPanes: 4 });
  });

  test("maxPanes=0 via env is accepted and means disabled", () => {
    expect(
      resolveSubagentConfig({ hostConfig: {}, env: { SIBYL_SUBAGENT_MAX_PANES: "0" }, logger }),
    ).toEqual({ enabled: false, maxPanes: 0 });
  });

  test("invalid env maxPanes throws (no fallback)", () => {
    expect(() =>
      resolveSubagentConfig({ hostConfig: {}, env: { SIBYL_SUBAGENT_MAX_PANES: "2.5" }, logger }),
    ).toThrow();
    expect(() =>
      resolveSubagentConfig({ hostConfig: {}, env: { SIBYL_SUBAGENT_MAX_PANES: "-1" }, logger }),
    ).toThrow();
  });

  test("invalid akane maxPanes throws even if sibyl has a valid value", () => {
    const hostConfig = {
      akane: { experimental: { watchdog: { subagentDisplay: { maxPanes: Number.NaN } } } },
      sibyl: { subagentDisplay: { maxPanes: 4 } },
    } as never;
    expect(() => resolveSubagentConfig({ hostConfig, env: {}, logger })).toThrow();
  });

  test("error message never contains raw invalid env value beyond the value itself", () => {
    const secret = "hunter2";
    expect(() =>
      resolveSubagentConfig({
        hostConfig: {},
        env: { SIBYL_SUBAGENT_MAX_PANES: secret },
        logger,
      }),
    ).toThrow();
    // The thrown message may include the offending string (it is config, not a credential),
    // but must not include OPENCODE_SERVER_PASSWORD values (covered by Task 4 logger tests).
  });
});

describe("resolveConnection", () => {
  test("env wins over pluginInput for serverUrl and directory", () => {
    expect(
      resolveConnection({
        pluginInput: { serverUrl: "http://a", directory: "/d1" },
        env: { OPENCODE_SERVER_URL: "http://b", OPENCODE_PROJECT_DIR: "/d2" },
        logger,
      }),
    ).toEqual({
      serverUrl: "http://b",
      directory: "/d2",
      username: undefined,
      password: undefined,
    });
  });

  test("invalid OPENCODE_SERVER_URL throws", () => {
    expect(() =>
      resolveConnection({
        pluginInput: {},
        env: { OPENCODE_SERVER_URL: "ftp://x" },
        logger,
      }),
    ).toThrow();
  });

  test("empty serverUrl and empty directory throw", () => {
    expect(() =>
      resolveConnection({ pluginInput: { serverUrl: "", directory: "" }, env: {}, logger }),
    ).toThrow();
  });

  test("username/password pass through from env", () => {
    expect(
      resolveConnection({
        pluginInput: { serverUrl: "http://a", directory: "/d" },
        env: { OPENCODE_SERVER_USERNAME: "u", OPENCODE_SERVER_PASSWORD: "p" },
        logger,
      }),
    ).toEqual({ serverUrl: "http://a", directory: "/d", username: "u", password: "p" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/subagent-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/subagent-config.ts
import type { Config as SdkConfig } from "@opencode-ai/sdk";
import { parseMaxPanesValue, validateServerUrl } from "./subagent-validation.js";
import type { SubagentLogger } from "./subagent-logger.js";

export interface SubagentConfig {
  enabled: boolean;
  maxPanes: number;
}

export interface ResolvedConnection {
  serverUrl: string;
  directory: string;
  username?: string | undefined;
  password?: string | undefined;
}

interface SubagentDisplayBlock {
  enabled?: unknown;
  maxPanes?: unknown;
}

function readBlock(hostConfig: SdkConfig, vendor: "akane" | "sibyl"): SubagentDisplayBlock {
  const root = hostConfig as unknown as Record<string, unknown>;
  if (vendor === "akane") {
    const akane = root.akane as Record<string, unknown> | undefined;
    const experimental = akane?.experimental as Record<string, unknown> | undefined;
    const watchdog = experimental?.watchdog as Record<string, unknown> | undefined;
    const block = watchdog?.subagentDisplay;
    return (block ?? {}) as SubagentDisplayBlock;
  }
  const sibyl = root.sibyl as Record<string, unknown> | undefined;
  return (sibyl?.subagentDisplay ?? {}) as SubagentDisplayBlock;
}

function parseBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const l = v.toLowerCase();
    if (l === "1" || l === "true" || l === "yes") return true;
    if (l === "0" || l === "false" || l === "no") return false;
  }
  return undefined;
}

export function resolveSubagentConfig(args: {
  pluginOptions?: Record<string, unknown> | undefined;
  hostConfig: SdkConfig;
  env: Record<string, string | undefined>;
  logger: SubagentLogger;
}): SubagentConfig {
  const { hostConfig, env, logger } = args;
  const akane = readBlock(hostConfig, "akane");
  const sibyl = readBlock(hostConfig, "sibyl");

  // enabled: env > akane > sibyl > default(false)
  let enabled: boolean | undefined = parseBool(env.SIBYL_SUBAGENT_ENABLED);
  if (enabled === undefined) enabled = parseBool(akane.enabled);
  if (enabled === undefined) enabled = parseBool(sibyl.enabled);
  if (enabled === undefined) enabled = false;

  // maxPanes: env > akane > sibyl > default(4)
  const candidates: Array<unknown> = [env.SIBYL_SUBAGENT_MAX_PANES, akane.maxPanes, sibyl.maxPanes];
  let resolved: number | undefined;
  for (const raw of candidates) {
    if (raw === undefined) continue;
    const candidate = typeof raw === "string" ? Number(raw) : raw;
    const parsed = parseMaxPanesValue(candidate);
    if (!parsed.ok) {
      logger.error("[subagent] invalid maxPanes configured");
      throw new Error("subagentDisplay.maxPanes: expected an integer in range 0..8");
    }
    resolved = parsed.value;
    break;
  }
  if (resolved === undefined) resolved = 4;

  return { enabled, maxPanes: resolved };
}

export function resolveConnection(args: {
  pluginInput: { serverUrl?: string | undefined; directory?: string | undefined };
  env: Record<string, string | undefined>;
  logger: SubagentLogger;
}): ResolvedConnection {
  const serverUrl = args.env.OPENCODE_SERVER_URL ?? args.pluginInput.serverUrl ?? "";
  const directory = args.env.OPENCODE_PROJECT_DIR ?? args.pluginInput.directory ?? "";
  if (serverUrl.length === 0 || !validateServerUrl(serverUrl)) {
    args.logger.error("[subagent] serverUrl is missing or invalid");
    throw new Error("serverUrl must be http/https");
  }
  if (directory.length === 0) {
    args.logger.error("[subagent] directory is missing");
    throw new Error("directory must be specified");
  }
  return {
    serverUrl,
    directory,
    username: args.env.OPENCODE_SERVER_USERNAME ?? undefined,
    password: args.env.OPENCODE_SERVER_PASSWORD ?? undefined,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/subagent-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify gates and commit**

Run: `bun run lint && bun run typecheck && bun test tests/subagent-config.test.ts`
Expected: all green.

```bash
git add src/subagent-config.ts tests/subagent-config.test.ts
git commit -m "feat: ConfigResolver（env > akane > sibyl の項目単位解決）を追加"
```

---

### Task 4: Attach argv builder + SubagentPaneAdapter + LayoutManager.forceFocus (PR C)

**Files:**
- Create: `src/subagent-attach-args.ts`
- Create: `src/subagent-types.ts`
- Create: `src/subagent-pane-adapter.ts`
- Modify: `src/layout-manager.tsx:24-40,204` (add `forceFocus` to `LayoutManagerController` interface and implementation)
- Test: `tests/subagent-attach-args.test.ts`
- Test: `tests/subagent-pane-adapter.test.ts`
- Modify: `tests/layout-manager.test.tsx` (add `forceFocus` test)

**Interfaces:**
- Consumes: `PaneBackend` (`./pane-backend.js`), `PtyManager` (`./pty-manager.js`), `PtyOptions`/`PaneModel` (`./types.js`) — all existing.
- Produces:
  - `src/subagent-types.ts`: `export interface SubagentLikeSession { id: string; parentID?: string | undefined; time: { created: number } }`; `export interface SubagentSessionClient { list(): Promise<SubagentLikeSession[]> }`; `export interface AttachTarget { sessionId: string; createdAt: number }`; `export interface SubagentPaneManager { open(target: AttachTarget): Promise<void>; close(sessionId: string): Promise<void>; listOpen(): string[]; }`.
  - `src/subagent-attach-args.ts`: `export function isWindows(): boolean`; `export function resolveOpencodeCommand(): string`; `export function buildAttachPtyOptions(args: { target: AttachTarget; serverUrl: string; directory: string; username?: string | undefined; password?: string | undefined }): PtyOptions`.
  - `src/subagent-pane-adapter.ts`: `export class SubagentPaneAdapter implements SubagentPaneManager` with `constructor(args: { layout: LayoutManagerController; paneBackend: PaneBackend; ptyManager: PtyManager; serverUrl: string; directory: string; username?: string | undefined; password?: string | undefined; logger: SubagentLogger })`.
  - `src/layout-manager.tsx`: `LayoutManagerController` gains `readonly forceFocus: (id: PaneId) => void`.

**Behavior contract:**
- `buildAttachPtyOptions` returns `command: "opencode.cmd"` on Windows (`process.platform === "win32"`) else `"opencode"`; `args` exactly `["attach", serverUrl, "--session", sessionId, "--dir", directory, "--mini"]` (positional `serverUrl` first, spec FR-1.4); `cwd: directory`; `env` contains **only** `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD` when defined (other vars are merged downstream by `PtyManager.spawn`, which spreads `process.env` — do NOT set credentials elsewhere). `env` values are `string`; use `Record<string, string>` cast via explicit per-key assignment (no `as any`). Never `-u`/`-p`.
- `SubagentPaneAdapter.open` is idempotent per `sessionId`: repeat call with an open pane is a no-op. It resolves the PTY handle *before* mutating the layout (spawn before split). On failure it logs (sanitized) and does not throw/crash (zero-crash). After successful spawn it calls `layout.splitPane("horizontal", ptyOptions, createPane)` — `createPane` comes from `paneBackend.create` — then calls `layout.forceFocus(newPaneId)` (spec FR-1.3).
- `close(sessionId)` is idempotent: unknown `sessionId` → no-op.

- [ ] **Step 1: Write the failing test for attach-args**

```ts
// tests/subagent-attach-args.test.ts
import { describe, expect, test } from "bun:test";
import { buildAttachPtyOptions, resolveOpencodeCommand } from "../src/subagent-attach-args";

describe("buildAttachPtyOptions", () => {
  test("argv order and values match spec FR-1.4", () => {
    const options = buildAttachPtyOptions({
      target: { sessionId: "ses-123", createdAt: 1 },
      serverUrl: "http://localhost:3000",
      directory: "/repo",
    });
    expect(options.args).toEqual([
      "attach",
      "http://localhost:3000",
      "--session",
      "ses-123",
      "--dir",
      "/repo",
      "--mini",
    ]);
    expect(options.command).toBe(resolveOpencodeCommand());
    expect(options.cwd).toBe("/repo");
  });

  test("credentials are env-only, never argv flags", () => {
    const options = buildAttachPtyOptions({
      target: { sessionId: "ses-123", createdAt: 1 },
      serverUrl: "http://localhost:3000",
      directory: "/repo",
      username: "alice",
      password: "s3cret",
    });
    const joined = options.args.join(" ");
    expect(joined).not.toContain("-u");
    expect(joined).not.toContain("-p");
    expect(joined).not.toContain("s3cret");
    expect(options.env?.OPENCODE_SERVER_USERNAME).toBe("alice");
    expect(options.env?.OPENCODE_SERVER_PASSWORD).toBe("s3cret");
  });

  test("env omits credential keys when undefined", () => {
    const options = buildAttachPtyOptions({
      target: { sessionId: "ses-123", createdAt: 1 },
      serverUrl: "http://localhost:3000",
      directory: "/repo",
    });
    expect(options.env).toBeUndefined();
  });

  test("invalid sessionId throws", () => {
    expect(() =>
      buildAttachPtyOptions({
        target: { sessionId: "bad;id", createdAt: 1 },
        serverUrl: "http://x",
        directory: "/d",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Write the failing test for the adapter**

```ts
// tests/subagent-pane-adapter.test.ts
import { describe, expect, test } from "bun:test";
import { SubagentPaneAdapter } from "../src/subagent-pane-adapter";
import type { LayoutManagerController } from "../src/layout-manager";
import type { PaneBackend } from "../src/pane-backend";
import type { PtyManager, PtyHandle } from "../src/pty-manager";
import type { PtyOptions, PaneModel } from "../src/types";
import type { SubagentLogger } from "../src/subagent-logger";

function fakePtyHandle(id: string): PtyHandle {
  return { id, write: () => {}, resize: () => {}, onData: () => () => {}, onExit: () => () => {} };
}

function makeLayout(spawned: PtyOptions[], forceFocused: string[]): LayoutManagerController {
  const noop = () => {};
  return {
    model: (() => ({})) as never,
    focusedId: () => "root-pane",
    splitPane: (_direction, ptyOptions) => {
      spawned.push(ptyOptions);
    },
    closePane: async () => {},
    focusNext: noop,
    focusPrev: noop,
    onPtyReady: async noop,
    onPtyExit: noop,
    onPtyCleanup: async noop,
    focusPane: noop,
    getInitialPtyHandle: () => undefined,
    getPendingPtyHandle: () => undefined,
    onPtySpawn: noop,
    mountPane: noop,
    unmountPane: noop,
    forceFocus: (id) => {
      forceFocused.push(id);
    },
  };
}

function makeBackend(): { backend: PaneBackend; created: PtyOptions[] } {
  const created: PtyOptions[] = [];
  let idCounter = 0;
  const backend: PaneBackend = {
    create(options) {
      created.push(options);
      return { id: `pane-${++idCounter}`, ptyOptions: options };
    },
    spawn(ptyManager, options) {
      return ptyManager.spawn(options);
    },
    write(session, data) {
      session.write(data);
    },
    resize(session, c, r) {
      session.resize(c, r);
    },
    terminate(ptyManager, ptyId) {
      return ptyManager.terminate(ptyId);
    },
  };
  return { backend, created };
}

describe("SubagentPaneAdapter", () => {
  test("open spawns PTY with attach argv and focuses new pane", async () => {
    const spawned: PtyOptions[] = [];
    const forceFocused: string[] = [];
    const logger: SubagentLogger = { info: () => {}, warn: () => {}, error: () => {} };
    const { backend } = makeBackend();
    const ptyManager = {
      spawn: async (o: PtyOptions) => fakePtyHandle(`pty-${spawned.length + 1}`),
      terminate: async () => {},
      terminateAll: async () => {},
    } as unknown as PtyManager;
    const adapter = new SubagentPaneAdapter({
      layout: makeLayout(spawned, forceFocused),
      paneBackend: backend,
      ptyManager,
      serverUrl: "http://localhost:3000",
      directory: "/repo",
      logger,
    });

    await adapter.open({ sessionId: "ses-abc", createdAt: 1 });

    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.args).toEqual([
      "attach",
      "http://localhost:3000",
      "--session",
      "ses-abc",
      "--dir",
      "/repo",
      "--mini",
    ]);
    expect(forceFocused).toHaveLength(1);
  });

  test("open is idempotent per sessionId", async () => {
    const spawned: PtyOptions[] = [];
    const forceFocused: string[] = [];
    const logger: SubagentLogger = { info: () => {}, warn: () => {}, error: () => {} };
    const { backend } = makeBackend();
    const ptyManager = {
      spawn: async () => fakePtyHandle("p1"),
      terminate: async () => {},
      terminateAll: async () => {},
    } as unknown as PtyManager;
    const adapter = new SubagentPaneAdapter({
      layout: makeLayout(spawned, forceFocused),
      paneBackend: backend,
      ptyManager,
      serverUrl: "http://x",
      directory: "/d",
      logger,
    });
    await adapter.open({ sessionId: "ses-1", createdAt: 1 });
    await adapter.open({ sessionId: "ses-1", createdAt: 1 });
    expect(spawned).toHaveLength(1);
  });

  test("close of unknown sessionId is a no-op", async () => {
    const logger: SubagentLogger = { info: () => {}, warn: () => {}, error: () => {} };
    const { backend } = makeBackend();
    const ptyManager = {
      spawn: async () => fakePtyHandle("p1"),
      terminate: async () => {},
      terminateAll: async () => {},
    } as unknown as PtyManager;
    let closes = 0;
    const layout = makeLayout([], []);
    const original = layout.closePane;
    layout.closePane = async (id) => {
      closes += 1;
      return original(id);
    };
    const adapter = new SubagentPaneAdapter({
      layout,
      paneBackend: backend,
      ptyManager,
      serverUrl: "http://x",
      directory: "/d",
      logger,
    });
    await adapter.close("never-opened");
    expect(closes).toBe(0);
  });

  test("listOpen reflects current sessions", async () => {
    const logger: SubagentLogger = { info: () => {}, warn: () => {}, error: () => {} };
    const { backend } = makeBackend();
    const ptyManager = {
      spawn: async () => fakePtyHandle("p1"),
      terminate: async () => {},
      terminateAll: async () => {},
    } as unknown as PtyManager;
    const adapter = new SubagentPaneAdapter({
      layout: makeLayout([], []),
      paneBackend: backend,
      ptyManager,
      serverUrl: "http://x",
      directory: "/d",
      logger,
    });
    await adapter.open({ sessionId: "ses-1", createdAt: 1 });
    expect(adapter.listOpen()).toEqual(["ses-1"]);
  });
});
```

- [ ] **Step 3: Write the failing test for `forceFocus` in layout-manager**

Append to `tests/layout-manager.test.tsx` (reuse that file's existing fake `api`/`PtyManager` scaffolding):

```ts
test("forceFocus sets focusedId to the given pane", async () => {
  // Given: a controller with two panes (root + one split)
  const controller = createLayoutManagerController(ptyManager as never, initialModel, backend);
  // When
  controller.forceFocus("pane-1");
  // Then
  expect(controller.focusedId()).toBe("pane-1");
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `bun test tests/subagent-attach-args.test.ts tests/subagent-pane-adapter.test.ts tests/layout-manager.test.tsx`
Expected: FAIL — modules not found; `forceFocus` not on `LayoutManagerController`.

- [ ] **Step 5: Implement `src/subagent-types.ts`**

```ts
export interface SubagentLikeSession {
  id: string;
  parentID?: string | undefined;
  time: { created: number };
}

export interface SubagentSessionClient {
  list(): Promise<SubagentLikeSession[]>;
}

export interface AttachTarget {
  sessionId: string;
  createdAt: number;
}

export interface SubagentPaneManager {
  open(target: AttachTarget): Promise<void>;
  close(sessionId: string): Promise<void>;
  listOpen(): string[];
}
```

- [ ] **Step 6: Implement `src/subagent-attach-args.ts`**

```ts
import { validateSessionId } from "./subagent-validation.js";
import type { PtyOptions } from "./types.js";
import type { AttachTarget } from "./subagent-types.js";

export function isWindows(): boolean {
  return process.platform === "win32";
}

export function resolveOpencodeCommand(): string {
  return isWindows() ? "opencode.cmd" : "opencode";
}

export function buildAttachPtyOptions(args: {
  target: AttachTarget;
  serverUrl: string;
  directory: string;
  username?: string | undefined;
  password?: string | undefined;
}): PtyOptions {
  if (!validateSessionId(args.target.sessionId)) {
    throw new Error("attach: invalid session id");
  }
  const env: Record<string, string> = {};
  if (args.username !== undefined) env.OPENCODE_SERVER_USERNAME = args.username;
  if (args.password !== undefined) env.OPENCODE_SERVER_PASSWORD = args.password;
  return {
    command: resolveOpencodeCommand(),
    args: [
      "attach",
      args.serverUrl,
      "--session",
      args.target.sessionId,
      "--dir",
      args.directory,
      "--mini",
    ],
    cwd: args.directory,
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}
```

- [ ] **Step 7: Add `forceFocus` to `LayoutManagerController` in `src/layout-manager.tsx`**

```ts
// in LayoutManagerController interface (after focusPane)
readonly forceFocus: (id: PaneId) => void;

// in createLayoutManagerController return object (after focusPane: setFocusedId)
forceFocus: setFocusedId,
```

- [ ] **Step 8: Implement `src/subagent-pane-adapter.ts`**

```ts
import type { LayoutManagerController } from "./layout-manager.js";
import type { PaneBackend } from "./pane-backend.js";
import type { PtyManager } from "./pty-manager.js";
import { buildAttachPtyOptions } from "./subagent-attach-args.js";
import type { SubagentLogger } from "./subagent-logger.js";
import { sanitizeSessionId } from "./subagent-logger.js";
import type { AttachTarget, SubagentPaneManager } from "./subagent-types.js";
import { findPane }, type { PaneModel } from "./keymap.js" // (see note below)
```

Note: `findPane` is exported from `keymap.js`. Use it to resolve the newly created pane's id — but rather than duplicating tree-search logic here, capture the pane via the `createPane` callback supplied to `layout.splitPane(direction, options, createPane)`. `splitPane` calls `createPane(newPtyOptions)` synchronously inside; store the returned `PaneModel.id`:

```ts
// src/subagent-pane-adapter.ts (full)
import type { LayoutManagerController } from "./layout-manager.js";
import type { PaneBackend } from "./pane-backend.js";
import type { PtyManager } from "./pty-manager.js";
import { sanitizeSessionId } from "./subagent-logger.js";
import type { SubagentLogger } from "./subagent-logger.js";
import { buildAttachPtyOptions } from "./subagent-attach-args.js";
import type { AttachTarget, SubagentPaneManager } from "./subagent-types.js";
import type { PaneModel } from "./types.js";

interface AdapterDeps {
  layout: LayoutManagerController;
  paneBackend: PaneBackend;
  ptyManager: PtyManager;
  serverUrl: string;
  directory: string;
  username?: string | undefined;
  password?: string | undefined;
  logger: SubagentLogger;
}

export class SubagentPaneAdapter implements SubagentPaneManager {
  private readonly paneBySession = new Map<string, string>();

  constructor(private readonly deps: AdapterDeps) {}

  async open(target: AttachTarget): Promise<void> {
    if (this.paneBySession.has(target.sessionId)) return;
    const { layout, paneBackend, ptyManager, serverUrl, directory, username, password, logger } =
      this.deps;
    const ptyOptions = buildAttachPtyOptions({
      target,
      serverUrl,
      directory,
      username,
      password,
    });
    try {
      // Resolve the PTY handle BEFORE mutating layout.
      await paneBackend.spawn(ptyManager, ptyOptions);
    } catch (error) {
      logger.warn(
        `[subagent] attach spawn failed for ${sanitizeSessionId(target.sessionId)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    let created: PaneModel | undefined;
    layout.splitPane("horizontal", ptyOptions, (options) => {
      created = paneBackend.create(options);
      return created;
    });
    if (created !== undefined) {
      this.deps.layout.forceFocus(created.id);
      this.paneBySession.set(target.sessionId, created.id);
    }
  }

  async close(sessionId: string): Promise<void> {
    const paneId = this.paneBySession.get(sessionId);
    if (paneId === undefined) return;
    await this.deps.layout.closePane(paneId);
    this.paneBySession.delete(sessionId);
  }

  listOpen(): string[] {
    return [...this.paneBySession.keys()];
  }
}
```

(If the `created` capture in `splitPane` turns out not to run synchronously against the existing `keymap.ts` — confirm by running the adapter test; if it runs later, instead re-scan the layout model via a local `findNewestLeaf` helper and use that id.)

- [ ] **Step 9: Run tests to verify they pass**

Run: `bun test tests/subagent-attach-args.test.ts tests/subagent-pane-adapter.test.ts tests/layout-manager.test.tsx`
Expected: all PASS.

- [ ] **Step 10: Verify gates and commit**

Run: `bun run lint && bun run typecheck && bun test`
Expected: all green.

```bash
git add src/subagent-types.ts src/subagent-attach-args.ts src/subagent-pane-adapter.ts \
  src/layout-manager.tsx \
  tests/subagent-attach-args.test.ts tests/subagent-pane-adapter.test.ts tests/layout-manager.test.tsx
git commit -m "feat: attach argv ビルダーと SubagentPaneAdapter（冪等 open/close）を追加"
```

---

### Task 5: Event sources (PR D)

**Files:**
- Create: `src/subagent-event-source.ts`
- Test: `tests/subagent-event-source.test.ts`

**Interfaces:**
- Consumes: `SubagentLikeSession` (Task 4/types), `SubagentLogger` (Task 2); SDK types from `@opencode-ai/sdk`: `import type { Event } from "@opencode-ai/sdk"` (or `@opencode-ai/sdk/v2` — whichever the host resolves; pin to the same import root used elsewhere in the codebase).
- Produces:
  - `export type SubagentEvent = | { type: "subagent.created"; session: SubagentLikeSession } | { type: "subagent.idle"; sessionId: string } | { type: "subagent.error"; sessionId?: string | undefined } | { type: "subagent.deleted"; sessionId: string }`.
  - `export interface SubagentEventSource { start(): void; stop(): Promise<void>; onEvent(handler: (event: SubagentEvent) => void): void; onReconnectRequired(handler: () => void): void; }`.
  - `export class TuiEventBusSource implements SubagentEventSource` — constructor `({ eventBus, logger }: { eventBus: TuiEventBusLike; logger: SubagentLogger })`; `TuiEventBusLike` is a structural subset `{ on(type, handler): () => void; off?(type, handler): void }`.
  - `export function buildSseHeaders(auth: { username?: string | undefined; password?: string | undefined }): Record<string, string>`.
  - `export class SseEventSource implements SubagentEventSource` — constructor `({ subscribe, listSessions, auth, logger, sleep, retryConfig }: SseDeps)`.

**Behavior contract:**
- `TuiEventBusSource.start()` subscribes to four SDK event types: `"session.created"`, `"session.idle"`, `"session.error"`, `"session.deleted"`; filters `session.created`/`session.deleted` events to `properties.info.parentID != null` before emitting; maps `session.idle` → `subagent.idle` (with `sessionID`), `session.error` → `subagent.error` (with optional `sessionID` — never throws when absent, spec FR-3.2).
- `buildSseHeaders` returns `{}` when no password; `{ Authorization: "Basic <base64(u:p)>" }` otherwise (`Buffer.from(`${u ?? ""}:${p}`).toString("base64")`); result never contains the raw password.
- `SseEventSource.start()` opens a background loop calling `deps.subscribe()` (an injectable wrapper around `client.event.subscribe()`); iterates `stream` with `for await`; on stream end or error: log (sanitized `sessionId`s only), call `onReconnectRequired()` handler, wait `sleep(delay)` with exponential backoff (`500 * 2^min(attempt, 6)` ms), then resubscribe; `stop()` aborts the loop and resolves. `maxAttempts` is unlimited (continuous operation); each event is converted via the same mapping as `TuiEventBusSource`; after each reconnect, also call `listSessions()` and emit `subagent.created` for each `parentID != null` session returned (this realises spec FR-4.2's in-band resync trigger — the lifecycle manager additionally pulls at start/reconnect for authority).

- [ ] **Step 1: Write the failing test**

```ts
// tests/subagent-event-source.test.ts
import { describe, expect, test } from "bun:test";
import { TuiEventBusSource, buildSseHeaders } from "../src/subagent-event-source";
import type { SubagentLogger } from "../src/subagent-logger";

const logger: SubagentLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe("TuiEventBusSource", () => {
  test("filters: root session.created is ignored", () => {
    const handlers = new Map<string, (e: unknown) => void>();
    const bus = {
      on: (t: string, h: (e: unknown) => void) => {
        handlers.set(t, h);
        return () => {};
      },
      off: () => {},
    };
    const received: unknown[] = [];
    const source = new TuiEventBusSource({ eventBus: bus, logger });
    source.onEvent((e) => received.push(e));
    source.start();
    handlers.get("session.created")?.({
      type: "session.created",
      properties: { info: { id: "s1", parentID: undefined, time: { created: 1 } } },
    });
    expect(received).toHaveLength(0);
    source.stop();
  });

  test("child session.created emits subagent.created with id/parentID/created", () => {
    const handlers = new Map<string, (e: unknown) => void>();
    const bus = {
      on: (t: string, h: (e: unknown) => void) => {
        handlers.set(t, h);
        return () => {};
      },
      off: () => {},
    };
    const received: unknown[] = [];
    const source = new TuiEventBusSource({ eventBus: bus, logger });
    source.onEvent((e) => received.push(e));
    source.start();
    handlers.get("session.created")?.({
      type: "session.created",
      properties: {
        info: { id: "ses-9", parentID: "root-1", time: { created: 42 }, title: "t" },
      },
    });
    expect(received).toEqual([
      {
        type: "subagent.created",
        session: { id: "ses-9", parentID: "root-1", time: { created: 42 } },
      },
    ]);
    source.stop();
  });

  test("session.idle maps to subagent.idle", () => {
    const handlers = new Map<string, (e: unknown) => void>();
    const bus = {
      on: (t: string, h: (e: unknown) => void) => {
        handlers.set(t, h);
        return () => {};
      },
      off: () => {},
    };
    const received: unknown[] = [];
    const source = new TuiEventBusSource({ eventBus: bus, logger });
    source.onEvent((e) => received.push(e));
    source.start();
    handlers.get("session.idle")?.({ type: "session.idle", properties: { sessionID: "ses-1" } });
    expect(received).toEqual([{ type: "subagent.idle", sessionId: "ses-1" }]);
    source.stop();
  });

  test("session.error with no sessionID is logged, no event emitted, no throw", () => {
    const errors: string[] = [];
    const lg: SubagentLogger = { info: () => {}, warn: () => {}, error: (m) => errors.push(m) };
    const handlers = new Map<string, (e: unknown) => void>();
    const bus = {
      on: (t: string, h: (e: unknown) => void) => {
        handlers.set(t, h);
        return () => {};
      },
      off: () => {},
    };
    const received: unknown[] = [];
    const source = new TuiEventBusSource({ eventBus: bus, logger: lg });
    source.onEvent((e) => received.push(e));
    source.start();
    handlers.get("session.error")?.({ type: "session.error", properties: {} });
    expect(received).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
    source.stop();
  });
});

describe("buildSseHeaders", () => {
  test("no password → empty", () => {
    expect(buildSseHeaders({ username: "u", password: undefined })).toEqual({});
    expect(buildSseHeaders({})).toEqual({});
  });
  test("password → Authorization Basic base64, raw value not present", () => {
    const headers = buildSseHeaders({ username: "u", password: "p@ss" });
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("u:p@ss").toString("base64")}`);
    expect(JSON.stringify(headers)).not.toContain("p@ss");
  });
});
```

(An `SseEventSource` behavior test for reconnect/resync happens in Task 6 with the lifecycle manager; here we only pin the header builder + `TuiEventBusSource` filtering/mapping.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/subagent-event-source.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/subagent-event-source.ts`**

```ts
import type { SubagentLikeSession } from "./subagent-types.js";
import type { SubagentLogger } from "./subagent-logger.js";
import { sanitizeSessionId } from "./subagent-logger.js";

export type SubagentEvent =
  | { type: "subagent.created"; session: SubagentLikeSession }
  | { type: "subagent.idle"; sessionId: string }
  | { type: "subagent.error"; sessionId?: string | undefined }
  | { type: "subagent.deleted"; sessionId: string };

export interface SubagentEventSource {
  start(): void;
  stop(): Promise<void>;
  onEvent(handler: (event: SubagentEvent) => void): void;
  onReconnectRequired(handler: () => void): void;
}

export interface TuiEventBusLike {
  on(type: string, handler: (event: unknown) => void): () => void;
  off?(type: string, handler: (event: unknown) => void): void;
}

interface SdkSessionCreated {
  type: "session.created" | "session.deleted";
  properties: { info: SubagentLikeSession & { parentID?: string | undefined } };
}
interface SdkSessionIdle {
  type: "session.idle";
  properties: { sessionID: string };
}
interface SdkSessionError {
  type: "session.error";
  properties: { sessionID?: string | undefined; error?: unknown };
}

export class TuiEventBusSource implements SubagentEventSource {
  private handlers: Array<(e: SubagentEvent) => void> = [];
  private offFns: Array<() => void> = [];

  constructor(private readonly deps: { eventBus: TuiEventBusLike; logger: SubagentLogger }) {}

  start(): void {
    const bus = this.deps.eventBus;
    this.offFns.push(
      bus.on("session.created", (e) => this.onSessionLifecycle(e as SdkSessionCreated, "created")),
      bus.on("session.deleted", (e) => this.onSessionLifecycle(e as SdkSessionCreated, "deleted")),
      bus.on("session.idle", (e) => {
        const evt = e as SdkSessionIdle;
        this.emit({ type: "subagent.idle", sessionId: evt.properties.sessionID });
      }),
      bus.on("session.error", (e) => {
        const evt = e as SdkSessionError;
        const sid = evt.properties.sessionID;
        if (sid === undefined) {
          this.deps.logger.error("[subagent] session.error without sessionID (see server logs)");
          return;
        }
        this.emit({ type: "subagent.error", sessionId: sid });
      }),
    );
  }

  async stop(): Promise<void> {
    for (const off of this.offFns) off();
    this.offFns = [];
  }

  onEvent(handler: (event: SubagentEvent) => void): void {
    this.handlers.push(handler);
  }

  onReconnectRequired(_handler: () => void): void {
    // In-process bus does not disconnect; resync is not driven from here.
  }

  private onSessionLifecycle(e: SdkSessionCreated, kind: "created" | "deleted"): void {
    const info = e.properties.info;
    if (info.parentID == null) return;
    const session: SubagentLikeSession = {
      id: info.id,
      parentID: info.parentID,
      time: { created: info.time.created },
    };
    if (kind === "created") this.emit({ type: "subagent.created", session });
    else this.emit({ type: "subagent.deleted", sessionId: info.id });
  }

  private emit(event: SubagentEvent): void {
    for (const h of this.handlers) h(event);
  }
}

export function buildSseHeaders(auth: {
  username?: string | undefined;
  password?: string | undefined;
}): Record<string, string> {
  if (auth.password === undefined) return {};
  const token = Buffer.from(`${auth.username ?? ""}:${auth.password}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

export interface SseDeps {
  subscribe(): Promise<{ stream: AsyncGenerator<unknown, void, unknown> }>;
  listSessions(): Promise<SubagentLikeSession[]>;
  auth: { username?: string | undefined; password?: string | undefined };
  logger: SubagentLogger;
  sleep(ms: number): Promise<void>;
}

export class SseEventSource implements SubagentEventSource {
  private handlers: Array<(e: SubagentEvent) => void> = [];
  private reconnectHandlers: Array<() => void> = [];
  private stopped = false;
  private loopPromise: Promise<void> | undefined;

  constructor(private readonly deps: SseDeps) {}

  start(): void {
    this.stopped = false;
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.loopPromise;
  }

  onEvent(handler: (event: SubagentEvent) => void): void {
    this.handlers.push(handler);
  }

  onReconnectRequired(handler: () => void): void {
    this.reconnectHandlers.push(handler);
  }

  private async runLoop(): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      try {
        const { stream } = await this.deps.subscribe();
        attempt = 0;
        for await (const raw of stream) {
          if (this.stopped) return;
          this.emitMapped(raw);
        }
      } catch (error) {
        if (this.stopped) return;
        this.deps.logger.warn(
          `[subagent] SSE stream error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (this.stopped) return;
      const delay = 500 * 2 ** Math.min(attempt, 6);
      await this.deps.sleep(delay);
      attempt += 1;
      for (const h of this.reconnectHandlers) h();
      try {
        const sessions = await this.deps.listSessions();
        for (const s of sessions) {
          if (s.parentID != null) this.emit({ type: "subagent.created", session: s });
        }
      } catch (error) {
        this.deps.logger.warn(
          `[subagent] resync listSessions failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private emitMapped(raw: unknown): void {
    const e = raw as { type?: string; properties?: Record<string, unknown> };
    switch (e.type) {
      case "session.created": {
        const info = e.properties?.info as SubagentLikeSession | undefined;
        if (info?.parentID != null) this.emit({ type: "subagent.created", session: info });
        return;
      }
      case "session.idle": {
        const sessionID = e.properties?.sessionID as string | undefined;
        if (sessionID !== undefined) this.emit({ type: "subagent.idle", sessionId: sessionID });
        return;
      }
      case "session.error": {
        const sessionID = e.properties?.sessionID as string | undefined;
        if (sessionID === undefined) {
          this.deps.logger.error("[subagent] session.error without sessionID");
          return;
        }
        this.emit({ type: "subagent.error", sessionId: sessionID });
        return;
      }
      case "session.deleted": {
        const info = e.properties?.info as { id?: string; parentID?: string | undefined } | undefined;
        if (info?.id !== undefined && info.parentID != null) {
          this.emit({ type: "subagent.deleted", sessionId: info.id });
        }
        return;
      }
      default:
        return;
    }
  }

  private emit(event: SubagentEvent): void {
    for (const h of this.handlers) h(event);
  }
}

// keep sanitizeSessionId imported for future warning sites; referenced via logger only
void sanitizeSessionId;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/subagent-event-source.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify gates and commit**

Run: `bun run lint && bun run typecheck && bun test tests/subagent-event-source.test.ts`
Expected: all green.

```bash
git add src/subagent-event-source.ts tests/subagent-event-source.test.ts
git commit -m "feat: TuiEventBusSource / SseEventSource（再試行・再同期連携付き）を追加"
```

---

### Task 6: SubagentLifecycleManager (PR E)

**Files:**
- Create: `src/subagent-lifecycle-manager.ts`
- Test: `tests/subagent-lifecycle-manager.test.ts`

**Interfaces:**
- Consumes: `SubagentEventSource`/`SubagentEvent` (Task 5), `SubagentPaneManager`/`AttachTarget`/`SubagentSessionClient`/`SubagentLikeSession` (Task 4), `SubagentConfig` (Task 3), `SubagentLogger` (Task 2).
- Produces: `export class SubagentLifecycleManager` with
  ```ts
  constructor(deps: {
    paneManager: SubagentPaneManager;
    eventSource: SubagentEventSource;
    sessionClient: SubagentSessionClient;
    config: SubagentConfig;
    logger: SubagentLogger;
  })
  start(): Promise<void>;
  stop(): Promise<void>;
  resyncNow(): Promise<void>;
  openTargetsForDebug(): ReadonlyMap<string, AttachTarget>;
  ```.

**Behavior contract (spec FR-1…FR-4, FR-2.1/2.2):**
- If `config.enabled === false` or `config.maxPanes === 0` → `start()` is a no-op; `stop()` is safe before `start()`.
- `start()`: subscribes to events (queue), calls `resyncNow()`, then begins draining. The queue guarantees per-session ordering and serializes open/close (no races between `session.list()` pull and live events).
- On `subagent.created`: skip if not `validateSessionId(session.id)`; skip duplicates; if `paneManager.listOpen().length >= config.maxPanes` → evict first: pick the open session with the smallest `AttachTarget.createdAt`, call `paneManager.close(oldestId)` before opening the new one. Then `paneManager.open({ sessionId, createdAt })` and record in `openTargets`.
- On `subagent.idle`/`subagent.error(id)`/`subagent.deleted`: close the pane and drop the tracking record. Close-once per session: a second event for an already-removed session is a no-op.
- On `subagent.error` with undefined sessionId: log only (already handled upstream).
- `resyncNow()`: calls `sessionClient.list()`; for every server session with `parentID != null` that is not currently tracked → emit `subagent.created` into the queue. For every tracked session not present in the server list → emit `subagent.deleted`. (Idempotent: repeat calls converge.)
- `stop()`: unsubscribes from the event source; for each tracked session → `paneManager.close(id)` (spec FR-4.4); waits for `eventSource.stop()`; clears the queue.
- Reconnect hook: registers `eventSource.onReconnectRequired(() => void this.resyncNow())` at construction.
- Zero-crash: no `await` on a user-visible path throws; internal errors are caught and logged (sanitized).

- [ ] **Step 1: Write the failing test**

```ts
// tests/subagent-lifecycle-manager.test.ts
import { describe, expect, test } from "bun:test";
import { SubagentLifecycleManager } from "../src/subagent-lifecycle-manager";
import type { SubagentEvent, SubagentEventSource } from "../src/subagent-event-source";
import type { SubagentPaneManager, AttachTarget, SubagentSessionClient } from "../src/subagent-types";
import type { SubagentLogger } from "../src/subagent-logger";

const logger: SubagentLogger = { info: () => {}, warn: () => {}, error: () => {} };

function makeSource(): {
  source: SubagentEventSource;
  emit(e: SubagentEvent): void;
  triggerReconnect(): void;
} {
  const handlers: Array<(e: SubagentEvent) => void> = [];
  const reconnectHandlers: Array<() => void> = [];
  return {
    source: {
      start: () => {},
      stop: async () => {},
      onEvent: (h) => handlers.push(h),
      onReconnectRequired: (h) => reconnectHandlers.push(h),
    },
    emit: (e) => handlers.forEach((h) => h(e)),
    triggerReconnect: () => reconnectHandlers.forEach((h) => h()),
  };
}

function makePane(): {
  pane: SubagentPaneManager;
  opened: AttachTarget[];
  closed: string[];
} {
  const opened: AttachTarget[] = [];
  const closed: string[] = [];
  const openSet = new Set<string>();
  return {
    pane: {
      open: async (t) => {
        opened.push(t);
        openSet.add(t.sessionId);
      },
      close: async (id) => {
        closed.push(id);
        openSet.delete(id);
      },
      listOpen: () => [...openSet],
    },
    opened,
    closed,
  };
}

function makeClient(sessions: Array<{ id: string; parentID?: string; time: { created: number } }>): SubagentSessionClient {
  return { list: async () => sessions };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SubagentLifecycleManager", () => {
  test("does nothing when disabled", async () => {
    const { source, emit } = makeSource();
    const { pane, opened } = makePane();
    const m = new SubagentLifecycleManager({
      paneManager: pane,
      eventSource: source,
      sessionClient: makeClient([]),
      config: { enabled: false, maxPanes: 4 },
      logger,
    });
    await m.start();
    emit({ type: "subagent.created", session: { id: "s-1", parentID: "p", time: { created: 1 } } });
    await flush();
    expect(opened).toHaveLength(0);
    await m.stop();
  });

  test("opens pane on subagent.created when enabled", async () => {
    const { source, emit } = makeSource();
    const { pane, opened } = makePane();
    const m = new SubagentLifecycleManager({
      paneManager: pane,
      eventSource: source,
      sessionClient: makeClient([]),
      config: { enabled: true, maxPanes: 4 },
      logger,
    });
    await m.start();
    emit({ type: "subagent.created", session: { id: "s-1", parentID: "p", time: { created: 1 } } });
    await flush();
    expect(opened).toEqual([{ sessionId: "s-1", createdAt: 1 }]);
    await m.stop();
  });

  test("duplicate created is idempotent", async () => {
    const { source, emit } = makeSource();
    const { pane, opened } = makePane();
    const m = new SubagentLifecycleManager({
      paneManager: pane,
      eventSource: source,
      sessionClient: makeClient([]),
      config: { enabled: true, maxPanes: 4 },
      logger,
    });
    await m.start();
    const evt = { type: "subagent.created" as const, session: { id: "s-1", parentID: "p", time: { created: 1 } } };
    emit(evt);
    emit(evt);
    await flush();
    expect(opened).toHaveLength(1);
    await m.stop();
  });

  test("closes pane on idle, error, deleted (once)", async () => {
    const { source, emit } = makeSource();
    const { pane, opened, closed } = makePane();
    const m = new SubagentLifecycleManager({
      paneManager: pane,
      eventSource: source,
      sessionClient: makeClient([]),
      config: { enabled: true, maxPanes: 4 },
      logger,
    });
    await m.start();
    emit({ type: "subagent.created", session: { id: "s-1", parentID: "p", time: { created: 1 } } });
    await flush();
    emit({ type: "subagent.idle", sessionId: "s-1" });
    emit({ type: "subagent.idle", sessionId: "s-1" }); // duplicate
    await flush();
    expect(opened).toHaveLength(1);
    expect(closed).toEqual(["s-1"]);
    await m.stop();
  });

  test("evicts oldest when maxPanes is exceeded (spec FR-2.2)", async () => {
    const { source, emit } = makeSource();
    const { pane, closed } = makePane();
    const m = new SubagentLifecycleManager({
      paneManager: pane,
      eventSource: source,
      sessionClient: makeClient([]),
      config: { enabled: true, maxPanes: 2 },
      logger,
    });
    await m.start();
    emit({ type: "subagent.created", session: { id: "s-1", parentID: "p", time: { created: 1 } } });
    emit({ type: "subagent.created", session: { id: "s-2", parentID: "p", time: { created: 2 } } });
    emit({ type: "subagent.created", session: { id: "s-3", parentID: "p", time: { created: 3 } } });
    await flush();
    expect(closed).toEqual(["s-1"]);
    expect(pane.listOpen().sort()).toEqual(["s-2", "s-3"]);
    await m.stop();
  });

  test("maxPanes=0 closes all existing panes and never opens (spec FR-2.1 disabled path)", async () => {
    const { source, emit } = makeSource();
    const { pane, opened, closed } = makePane();
    // pre-populate one "existing" pane via the pane manager itself
    await pane.open({ sessionId: "pre-1", createdAt: 0 });
    const m = new SubagentLifecycleManager({
      paneManager: pane,
      eventSource: source,
      sessionClient: makeClient([{ id: "pre-1", parentID: "p", time: { created: 0 } }]),
      config: { enabled: true, maxPanes: 0 },
      logger,
    });
    await m.start();
    await flush();
    emit({ type: "subagent.created", session: { id: "s-9", parentID: "p", time: { created: 9 } } });
    await flush();
    expect(opened.filter((o) => o.sessionId === "s-9")).toHaveLength(0);
    expect(closed).toContain("pre-1");
    await m.stop();
  });

  test("resync: creates unknown child sessions and closes vanished ones", async () => {
    const { source } = makeSource();
    const { pane, opened, closed } = makePane();
    const m = new SubagentLifecycleManager({
      paneManager: pane,
      eventSource: source,
      sessionClient: makeClient([
        { id: "child-1", parentID: "root", time: { created: 5 } },
        { id: "root", parentID: undefined, time: { created: 1 } },
      ]),
      config: { enabled: true, maxPanes: 4 },
      logger,
    });
    await m.start();
    // At this point resync opened child-1. Now simulate a second resync with empty list:
    (m as unknown as { deps: { sessionClient: SubagentSessionClient } }).deps.sessionClient =
      makeClient([]);
    await m.resyncNow();
    await flush();
    expect(opened.map((o) => o.sessionId)).toContain("child-1");
    expect(closed).toContain("child-1");
    await m.stop();
  });

  test("reconnect hook triggers resync", async () => {
    const { source, triggerReconnect } = makeSource();
    const { pane, opened } = makePane();
    const client = makeClient([{ id: "c-1", parentID: "r", time: { created: 2 } }]);
    const m = new SubagentLifecycleManager({
      paneManager: pane,
      eventSource: source,
      sessionClient: client,
      config: { enabled: true, maxPanes: 4 },
      logger,
    });
    await m.start();
    await flush();
    triggerReconnect();
    await flush();
    expect(pane.listOpen()).toContain("c-1");
    expect(opened).toHaveLength(1);
    await m.stop();
  });

  test("stop() closes all tracked panes and is safe before start", async () => {
    const { source, emit } = makeSource();
    const { pane, closed } = makePane();
    const m0 = new SubagentLifecycleManager({
      paneManager: pane,
      eventSource: source,
      sessionClient: makeClient([]),
      config: { enabled: true, maxPanes: 4 },
      logger,
    });
    await m0.stop(); // safe no-op
    const m = new SubagentLifecycleManager({
      paneManager: pane,
      eventSource: source,
      sessionClient: makeClient([]),
      config: { enabled: true, maxPanes: 4 },
      logger,
    });
    await m.start();
    emit({ type: "subagent.created", session: { id: "x-1", parentID: "p", time: { created: 1 } } });
    await flush();
    await m.stop();
    expect(closed).toContain("x-1");
  });

  test("root (no parentID) sessions are never opened", async () => {
    const { source, emit } = makeSource();
    const { pane, opened } = makePane();
    const m = new SubagentLifecycleManager({
      paneManager: pane,
      eventSource: source,
      sessionClient: makeClient([{ id: "root-1", parentID: undefined, time: { created: 1 } }]),
      config: { enabled: true, maxPanes: 4 },
      logger,
    });
    await m.start();
    emit({
      type: "subagent.created",
      session: { id: "root-2", parentID: undefined, time: { created: 2 } },
    });
    await flush();
    expect(opened).toHaveLength(0);
    await m.stop();
  });
});
```

(Replace the `(m as unknown as …)` resync hack with a `config` injection seam if preferred: construct the manager with a `sessionClient` field you can reassign via a test setter — but keep the interface given in the "Produces" block unchanged.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/subagent-lifecycle-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/subagent-lifecycle-manager.ts`**

Serial queue design: a simple `Promise<void>` chain (`this.tail`) into which every handler enqueues its async work. `subagent.created`/`idle`/`error`/`deleted` events push onto the queue; `resyncNow()` computes the diff and pushes the resulting synthesized events onto the same queue (so live events and pulls never interleave out of order). Eviction is performed *inside* the same task that opens a new session (close-then-open within one tick).

```ts
import type { SubagentEvent, SubagentEventSource } from "./subagent-event-source.js";
import type { SubagentLogger } from "./subagent-logger.js";
import { sanitizeSessionId } from "./subagent-logger.js";
import type {
  AttachTarget,
  SubagentLikeSession,
  SubagentPaneManager,
  SubagentSessionClient,
} from "./subagent-types.js";
import { validateSessionId } from "./subagent-validation.js";
import type { SubagentConfig } from "./subagent-config.js";

export class SubagentLifecycleManager {
  private readonly openTargets = new Map<string, AttachTarget>();
  private queue: Array<() => Promise<void>> = [];
  private draining = false;
  private started = false;

  constructor(
    private readonly deps: {
      paneManager: SubagentPaneManager;
      eventSource: SubagentEventSource;
      sessionClient: SubagentSessionClient;
      config: SubagentConfig;
      logger: SubagentLogger;
    },
  ) {
    this.deps.eventSource.onEvent((event) => this.enqueueEvent(event));
    this.deps.eventSource.onReconnectRequired(() => {
      void this.resyncNow();
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { config, eventSource, paneManager } = this.deps;
    if (!config.enabled || config.maxPanes === 0) {
      if (config.maxPanes === 0 && config.enabled) {
        for (const id of paneManager.listOpen()) {
          await paneManager.close(id);
        }
      }
      return;
    }
    eventSource.start();
    await this.resyncNow();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.queue = [];
    const { eventSource, paneManager, logger } = this.deps;
    try {
      for (const id of paneManager.listOpen()) {
        await paneManager.close(id);
      }
      this.openTargets.clear();
    } catch (error) {
      logger.warn(`[subagent] error during stop cleanup: ${String(error)}`);
    }
    await eventSource.stop();
  }

  async resyncNow(): Promise<void> {
    const { sessionClient, logger } = this.deps;
    let serverChildren: SubagentLikeSession[];
    try {
      const all = await sessionClient.list();
      serverChildren = all.filter((s) => s.parentID != null);
    } catch (error) {
      logger.warn(`[subagent] resync list failed: ${String(error)}`);
      return;
    }
    const serverIds = new Set(serverChildren.map((s) => s.id));
    for (const s of serverChildren) {
      if (!this.openTargets.has(s.id)) {
        this.enqueueEvent({ type: "subagent.created", session: s });
      }
    }
    for (const tracked of this.openTargets.keys()) {
      if (!serverIds.has(tracked)) {
        this.enqueueEvent({ type: "subagent.deleted", sessionId: tracked });
      }
    }
  }

  openTargetsForDebug(): ReadonlyMap<string, AttachTarget> {
    return this.openTargets;
  }

  private enqueueEvent(event: SubagentEvent): void {
    if (!this.started) return;
    this.queue.push(() => this.handleEvent(event));
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const job = this.queue.shift();
        if (job === undefined) return;
        await job();
      }
    } finally {
      this.draining = false;
    }
  }

  private async handleEvent(event: SubagentEvent): Promise<void> {
    try {
      switch (event.type) {
        case "subagent.created":
          await this.onCreated(event.session);
          return;
        case "subagent.idle":
          await this.onClosed(event.sessionId);
          return;
        case "subagent.error":
          if (event.sessionId !== undefined) await this.onClosed(event.sessionId);
          return;
        case "subagent.deleted":
          await this.onClosed(event.sessionId);
          return;
      }
    } catch (error) {
      this.deps.logger.warn(`[subagent] event handler error: ${String(error)}`);
    }
  }

  private async onCreated(session: SubagentLikeSession): Promise<void> {
    if (session.parentID == null) return;
    if (!validateSessionId(session.id)) {
      this.deps.logger.warn(`[subagent] invalid session id ${sanitizeSessionId(session.id)}`);
      return;
    }
    if (this.openTargets.has(session.id)) return;
    const { paneManager, config, logger } = this.deps;
    while (paneManager.listOpen().length >= config.maxPanes) {
      const oldestId = this.oldestOpenSessionId();
      if (oldestId === undefined) break;
      logger.info(`[subagent] evict ${sanitizeSessionId(oldestId)}`);
      await paneManager.close(oldestId);
      this.openTargets.delete(oldestId);
    }
    await paneManager.open({ sessionId: session.id, createdAt: session.time.created });
    this.openTargets.set(session.id, {
      sessionId: session.id,
      createdAt: session.time.created,
    });
  }

  private async onClosed(sessionId: string): Promise<void> {
    if (!this.openTargets.has(sessionId)) return;
    await this.deps.paneManager.close(sessionId);
    this.openTargets.delete(sessionId);
  }

  private oldestOpenSessionId(): string | undefined {
    let best: AttachTarget | undefined;
    for (const target of this.openTargets.values()) {
      if (best === undefined || target.createdAt < best.createdAt) best = target;
    }
    if (best !== undefined) return best.sessionId;
    // Fallback: if tracking is empty but pane manager reports opens, drop the first one.
    const open = this.deps.paneManager.listOpen();
    return open[0];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/subagent-lifecycle-manager.test.ts`
Expected: PASS (all tests, including eviction, resync, idempotency, disabled paths).

- [ ] **Step 5: Verify gates and commit**

Run: `bun run lint && bun run typecheck && bun test`
Expected: all green.

```bash
git add src/subagent-lifecycle-manager.ts tests/subagent-lifecycle-manager.test.ts
git commit -m "feat: SubagentLifecycleManager（状態機械・evict・再同期・dispose）を追加"
```

---

### Task 7: attachSubagentIntegration factory (PR F)

**Files:**
- Create: `src/subagent-integration.ts`
- Test: `tests/subagent-integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3-6; `TuiPluginApi` (type from `@opencode-ai/plugin/tui`); `LayoutManagerController` (existing); `PtyManager` (existing); `OpenTuiPaneBackend` (existing).
- Produces:
  - `export interface SubagentIntegrationOptions { enabled?: boolean; maxPanes?: number }` (pluginOptions overrides; `undefined` fields defer to hostConfig/env).
  - `export interface SubagentIntegrationHandle { enabled: boolean; stop(): Promise<void>; resyncNow(): Promise<void>; manager?: SubagentLifecycleManager }`.
  - `export function createDefaultAttachTarget(session: SubagentLikeSession): AttachTarget`.
  - `export function createOpenTuiSubagentPaneManager(args: { layout: LayoutManagerController; ptyManager: PtyManager; paneBackend: PaneBackend; serverUrl: string; directory: string; username?: string | undefined; password?: string | undefined; logger: SubagentLogger }): SubagentPaneManager` (thin wrapper over `SubagentPaneAdapter`).
  - `export function attachSubagentIntegration(api: TuiPluginApi, options: SubagentIntegrationOptions, deps: { layout: LayoutManagerController; ptyManager: PtyManager; paneBackend: PaneBackend; logger?: SubagentLogger; env?: Record<string, string | undefined> }): Promise<SubagentIntegrationHandle>`.

**Behavior contract:**
- Env defaults to `process.env`; logger defaults to `consoleSubagentLogger`.
- Merges `options.enabled`/`options.maxPanes` into an effective env override before calling `resolveSubagentConfig` so that explicit pluginOptions still respect env > akane > sibyl via the standard layer order (pluginOptions sit between "env" and "akane" in precedence only when provided as *strings* matching env-naming; see implementation below — simplest correct route: if `options.enabled !== undefined`, synthesize `env.SIBYL_SUBAGENT_ENABLED = String(options.enabled)`; likewise for maxPanes, **but only when the real env var is unset**).
- Reads `hostConfig` from `api.state.config`. Reads `pluginInput` fields as `{ serverUrl: undefined, directory: api.state.path.directory }` (TUI-side `serverUrl` is not exposed on `TuiPluginApi`; rely on `OPENCODE_SERVER_URL` env or absence). If resolution returns `enabled=false`, return `{ enabled, stop: async () => {}, resyncNow: async () => {} }` immediately (zero setup).
- Event-source selection: default `TuiEventBusSource({ eventBus: api.event })`. Only use `SseEventSource` when an env flag is explicitly set (e.g., `SIBYL_SUBAGENT_SSE=1`); construct it as `new SseEventSource({ subscribe: () => api.client.event.subscribe(), listSessions: () => api.client.session.list().then((r) => (Array.isArray((r as { data?: unknown }).data) ? ((r as { data: SubagentLikeSession[] }).data) : []), auth, logger, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) })`.
- Registers `api.lifecycle.onDispose(() => manager.stop())` so FR-4.4 is guaranteed on TUI shutdown.
- Registers `sibyl.toggleSubagentDisplay` command with `api.keymap.registerLayer`; the command's `run` is a no-op when `enabled === false` (config still off), otherwise logs an info message via `logger.info("[subagent] toggle is config-driven at startup")` (kept minimal; toggling persistence is out of scope).

- [ ] **Step 1: Write the failing test**

```ts
// tests/subagent-integration.test.ts
import { describe, expect, test } from "bun:test";
import { attachSubagentIntegration } from "../src/subagent-integration";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { LayoutManagerController } from "../src/layout-manager";
import type { PtyManager } from "../src/pty-manager";
import type { PaneBackend } from "../src/pane-backend";

function makeApi(stateConfig: unknown): {
  api: TuiPluginApi;
  onDisposeHandlers: Array<() => unknown>;
  layers: unknown[];
} {
  const onDisposeHandlers: Array<() => unknown> = [];
  const layers: unknown[] = [];
  const api = {
    state: { config: stateConfig, path: { directory: "/repo" } },
    client: { session: { list: async () => ({ data: [] }) } },
    event: { on: () => () => {}, off: () => {} },
    keymap: { registerLayer: (l: unknown) => (layers.push(l), () => {}) },
    lifecycle: { onDispose: (h: () => unknown) => (onDisposeHandlers.push(h), () => {}) },
    route: { register: () => () => {}, navigate: () => {}, current: undefined },
  } as unknown as TuiPluginApi;
  return { api, onDisposeHandlers, layers };
}

const layout = {} as LayoutManagerController;
const backend = {} as PaneBackend;
const ptyManager = {} as PtyManager;

describe("attachSubagentIntegration", () => {
  test("enabled=false (default) → disabled handle, no dispose handler for manager", async () => {
    const { api } = makeApi({});
    const handle = await attachSubagentIntegration(api, {}, {
      layout,
      paneBackend: backend,
      ptyManager,
      env: {},
    });
    expect(handle.enabled).toBe(false);
    await handle.stop();
  });

  test("enabled=true via env → handle.enabled=true, resyncNow is callable", async () => {
    const { api } = makeApi({});
    const handle = await attachSubagentIntegration(api, {}, {
      layout,
      paneBackend: backend,
      ptyManager,
      env: { SIBYL_SUBAGENT_ENABLED: "true", OPENCODE_SERVER_URL: "http://x", OPENCODE_PROJECT_DIR: "/d" },
    });
    expect(handle.enabled).toBe(true);
    await handle.stop();
  });

  test("options.enabled=true is converted to an env override only when real env is unset", async () => {
    const { api } = makeApi({});
    const handle = await attachSubagentIntegration(api, { enabled: true }, {
      layout,
      paneBackend: backend,
      ptyManager,
      env: { OPENCODE_SERVER_URL: "http://x", OPENCODE_PROJECT_DIR: "/d" },
    });
    expect(handle.enabled).toBe(true);
    await handle.stop();
  });

  test("invalid maxPanes via env surfaces a thrown configuration error", async () => {
    const { api } = makeApi({});
    await expect(
      attachSubagentIntegration(api, {}, {
        layout,
        paneBackend: backend,
        ptyManager,
        env: {
          SIBYL_SUBAGENT_ENABLED: "true",
          SIBYL_SUBAGENT_MAX_PANES: "-1",
          OPENCODE_SERVER_URL: "http://x",
          OPENCODE_PROJECT_DIR: "/d",
        },
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/subagent-integration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/subagent-integration.ts`**

Per contract above. Pseudocode body:

```ts
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Config as SdkConfig } from "@opencode-ai/sdk";
import type { LayoutManagerController } from "./layout-manager.js";
import type { OpenTuiPaneBackend } from "./opentui-pane-backend.js";
import type { PaneBackend } from "./pane-backend.js";
import type { PtyManager } from "./pty-manager.js";
import { resolveConnection, resolveSubagentConfig } from "./subagent-config.js";
import { SubagentPaneAdapter } from "./subagent-pane-adapter.js";
import { SubagentLifecycleManager } from "./subagent-lifecycle-manager.js";
import { TuiEventBusSource, SseEventSource, buildSseHeaders } from "./subagent-event-source.js";
import { consoleSubagentLogger, sanitizeSessionId } from "./subagent-logger.js";
import type { SubagentLogger } from "./subagent-logger.js";
import type {
  AttachTarget,
  SubagentLikeSession,
  SubagentPaneManager,
  SubagentSessionClient,
} from "./subagent-types.js";

export interface SubagentIntegrationOptions {
  enabled?: boolean;
  maxPanes?: number;
}

export interface SubagentIntegrationHandle {
  enabled: boolean;
  stop(): Promise<void>;
  resyncNow(): Promise<void>;
  manager?: SubagentLifecycleManager;
}

export function createDefaultAttachTarget(session: SubagentLikeSession): AttachTarget {
  return { sessionId: session.id, createdAt: session.time.created };
}

export function createOpenTuiSubagentPaneManager(args: {
  layout: LayoutManagerController;
  ptyManager: PtyManager;
  paneBackend: PaneBackend;
  serverUrl: string;
  directory: string;
  username?: string | undefined;
  password?: string | undefined;
  logger: SubagentLogger;
}): SubagentPaneManager {
  return new SubagentPaneAdapter(args);
}

export async function attachSubagentIntegration(
  api: TuiPluginApi,
  options: SubagentIntegrationOptions,
  deps: {
    layout: LayoutManagerController;
    ptyManager: PtyManager;
    paneBackend: PaneBackend;
    logger?: SubagentLogger;
    env?: Record<string, string | undefined>;
  },
): Promise<SubagentIntegrationHandle> {
  const logger = deps.logger ?? consoleSubagentLogger;
  const rawEnv = deps.env ?? process.env;
  // Synthesize env overrides from pluginOptions only when real env vars are unset.
  const env: Record<string, string | undefined> = { ...rawEnv };
  if (options.enabled !== undefined && env.SIBYL_SUBAGENT_ENABLED === undefined) {
    env.SIBYL_SUBAGENT_ENABLED = options.enabled ? "true" : "false";
  }
  if (options.maxPanes !== undefined && env.SIBYL_SUBAGENT_MAX_PANES === undefined) {
    env.SIBYL_SUBAGENT_MAX_PANES = String(options.maxPanes);
  }

  const hostConfig = api.state.config as SdkConfig;
  const config = resolveSubagentConfig({ hostConfig, env, logger });
  if (!config.enabled || config.maxPanes === 0) {
    return {
      enabled: false,
      stop: async () => {},
      resyncNow: async () => {},
    };
  }

  const connection = resolveConnection({
    pluginInput: { serverUrl: undefined, directory: api.state.path.directory },
    env,
    logger,
  });

  const paneManager = createOpenTuiSubagentPaneManager({
    layout: deps.layout,
    ptyManager: deps.ptyManager,
    paneBackend: deps.paneBackend,
    serverUrl: connection.serverUrl,
    directory: connection.directory,
    username: connection.username,
    password: connection.password,
    logger,
  });

  const useSse = env.SIBYL_SUBAGENT_SSE === "1" || env.SIBYL_SUBAGENT_SSE === "true";
  const sessionClient: SubagentSessionClient = {
    list: async () => {
      const result = await api.client.session.list();
      const data = (result as { data?: unknown }).data;
      return Array.isArray(data) ? (data as SubagentLikeSession[]) : [];
    },
  };

  const eventSource = useSse
    ? new SseEventSource({
        subscribe: () => api.client.event.subscribe(),
        listSessions: () => sessionClient.list(),
        auth: { username: connection.username, password: connection.password },
        logger,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      })
    : new TuiEventBusSource({ eventBus: api.event, logger });

  const manager = new SubagentLifecycleManager({
    paneManager,
    eventSource,
    sessionClient,
    config,
    logger,
  });
  await manager.start();

  api.lifecycle.onDispose(() => manager.stop());
  api.keymap.registerLayer({
    commands: [
      {
        name: "sibyl.toggleSubagentDisplay",
        title: "Toggle Subagent Display",
        desc: "Subagent display is configured at startup; edit config to toggle.",
        category: "Plugin",
        run: () => logger.info("[subagent] toggle is config-driven at startup"),
      },
    ],
    bindings: [],
  });

  return {
    enabled: true,
    stop: () => manager.stop(),
    resyncNow: () => manager.resyncNow(),
    manager,
  };
}

// Silence unused-import warnings for helpers kept for API surface parity.
void sanitizeSessionId;
void buildSseHeaders;
void OpenTuiPaneBackend;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/subagent-integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify gates and commit**

Run: `bun run lint && bun run typecheck && bun test tests/subagent-integration.test.ts`
Expected: all green.

```bash
git add src/subagent-integration.ts tests/subagent-integration.test.ts
git commit -m "feat: attachSubagentIntegration ファクトリを追加"
```

---

### Task 8: TUI wiring + server toggle command (PR F)

**Files:**
- Modify: `src/tui.tsx` (wire `attachSubagentIntegration` after `LayoutManager` setup; keep existing keymap/route registrations unchanged)
- Modify: `src/server.ts` (add `sibyl.toggleSubagentDisplay` command description in `config.command`)
- Modify: `src/index.ts` (re-export new modules)
- Modify: `tests/tui.test.ts` (assert integration registration behavior behind a stubbed `api`)
- Modify: `tests/server.test.ts` (assert new command registered)

**Interfaces:**
- Consumes: `attachSubagentIntegration` (Task 7).
- Produces: `src/tui.tsx` `createTuiPlugin` passes its `ptyManager`/`paneBackend` through to `attachSubagentIntegration` unless `createTuiPlugin` is called with explicit test doubles — in production path the plugin now self-wires; test path in `tests/tui.test.ts` stubs `attachSubagentIntegration` via a monkey-patch or via injecting a factory (choose the seam later: keep `createTuiPlugin(ptyManager?, paneBackend?, integrationFactory = attachSubagentIntegration)`).

- [ ] **Step 1: Write the failing test**

Append to `tests/server.test.ts` inside the existing `describe`:

```ts
test("registers the subagent toggle command description", async () => {
  const hooks = await Reflect.apply(plugin.server, undefined, [undefined]);
  const config: { command?: Record<string, Record<string, string>> } = {};
  await hooks.config?.(config);
  expect(config.command?.["sibyl.toggleSubagentDisplay"]).toBeDefined();
});
```

Append to `tests/tui.test.ts`:

```ts
test("wires attachSubagentIntegration with the layout and pty manager", async () => {
  const calls: Array<{ api: unknown; options: unknown }> = [];
  const factory = async (api: unknown, options: unknown) => {
    calls.push({ api, options });
    return { enabled: false, stop: async () => {}, resyncNow: async () => {} };
  };
  const tuiModule = await import("../src/tui");
  const created = tuiModule.createTuiPlugin(
    { spawn: async () => { throw new Error("nope"); }, terminate: async () => {}, terminateAll: async () => {} },
    undefined,
    factory as never,
  );
  const api = {
    route: { register: () => () => {}, navigate: () => {} },
    keymap: { registerLayer: () => () => {} },
    lifecycle: { onDispose: () => () => {} },
    state: { config: {}, path: { directory: "/repo" } },
    client: { session: { list: async () => ({ data: [] }) } },
    event: { on: () => () => {}, off: () => {} },
  };
  await Reflect.apply(created, undefined, [api, undefined, undefined]);
  expect(calls).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/server.test.ts tests/tui.test.ts`
Expected: FAIL — command not registered; integration factory not called.

- [ ] **Step 3: Modify `src/server.ts`**

Inside the existing `config.command` block, add:

```ts
    config.command["sibyl.toggleSubagentDisplay"] = {
      description: "Toggle Sibyl subagent display",
      template: "Toggle the Sibyl subagent display (configured at startup).",
    };
```

(Do not change `command.execute.before` — server-side is a deliberate no-op.)

- [ ] **Step 4: Modify `src/tui.tsx` to accept the integration factory and call it**

Change the signature and add a wire-up call at the end of the plugin setup (after `api.lifecycle.onDispose(() => ptyManager.terminateAll())`):

```ts
type SubagentIntegration = (
  api: TuiPluginApi,
  options: { enabled?: boolean; maxPanes?: number },
  deps: {
    layout: LayoutManagerController;
    ptyManager: PtyManager;
    paneBackend: PaneBackend;
  },
) => Promise<{ enabled: boolean; stop(): Promise<void>; resyncNow(): Promise<void>; manager?: unknown }>;

export function createTuiPlugin(
  ptyManager: TuiPtyManager = new PtyManager(undefined, () => import("node-pty")),
  paneBackend: PaneBackend = new OpenTuiPaneBackend(),
  subagentIntegrationFactory?: SubagentIntegration,
): TuiPlugin {
  return async (api, options) => {
    // ... existing route/keymap/lifecycle setup unchanged ...
    const factory = subagentIntegrationFactory ?? (await import("./subagent-integration.js")).attachSubagentIntegration;
    await factory(api, options as { enabled?: boolean; maxPanes?: number } | undefined ?? {}, {
      layout,
      ptyManager: ptyManager as PtyManager,
      paneBackend,
    });
    api.lifecycle.onDispose(() => ptyManager.terminateAll());
  };
}
```

Cast note: `TuiPtyManager` is `Pick<PtyManager, "spawn" | "terminate" | "terminateAll">`; passing it where `PtyManager` is expected requires widening. Acceptable seam: change the factory's `deps.ptyManager` type to the `Pick` shape (do not introduce `as any`). Apply the same widening in `attachSubagentIntegration` if needed.

- [ ] **Step 5: Re-export new modules from `src/index.ts`**

Add to `src/index.ts` (keep existing exports intact):

```ts
export * from "./subagent-validation.js";
export * from "./subagent-logger.js";
export * from "./subagent-config.js";
export * from "./subagent-types.js";
export * from "./subagent-attach-args.js";
export * from "./subagent-pane-adapter.js";
export * from "./subagent-event-source.js";
export * from "./subagent-lifecycle-manager.js";
export * from "./subagent-integration.js";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/server.test.ts tests/tui.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify gates and commit**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: all green (full suite including browser-condition integration tests).

```bash
git add src/server.ts src/tui.tsx src/index.ts tests/server.test.ts tests/tui.test.ts
git commit -m "feat: TUI/サーバーにサブエージェント表示統合を配線"
```

---

## Self-Review (author-ran, 2026-08-09)

**Spec coverage map:**
- FR-1.1/1.3/1.4 (auto display, horizontal split, positional-first argv, validation, env-only credentials, no shell) → Tasks 1, 4. argv equality asserted in `buildAttachPtyOptions` and adapter test.
- FR-1.2 (feature toggle, default off) → Tasks 3, 7, 8.
- FR-2.1 (maxPanes 1–8; 0=disabled; negative/float/NaN → throw without fallback) → Task 3 (`parseMaxPanesValue` + `resolveSubagentConfig` throw path). Boundary test 0 / −1 / 2.5 / NaN / 1 / 8 present.
- FR-2.2 (evict oldest by `time.created`) → Task 6 (`oldestOpenSessionId` + eviction test).
- FR-3.1/3.2/3.3 (idle, error-without-id logs only, deleted) → Tasks 5 (mapping), 6 (close-once per session).
- FR-4.1/4.2/4.3/4.4 (start/reconnect pull, diff & resync, idempotency, dispose cleanup) → Tasks 5 (SseEventSource resync hook), 6 (resyncNow / stop), 7 (onDispose registration).
- §5 Security (no shell, input validation, credentials never logged) → Tasks 1, 4 (env-only + argv inspection), 2 (`sanitizeSessionId`/`truncate`).
- §6 Config schema (env > akane > sibyl per-field, applies to `serverUrl`/`directory` too) → Task 3.
- §8 Test strategy (unit + smoke) → all unit tests above; smoke procedure is manual and listed below under "Manual smoke checks" (not a task — needs a live OpenCode server).

**Placeholder scan:** No `TBD`/`TODO`/`implement later` in code blocks. One open seam explicitly flagged (Task 4 Step 8's `created` capture via `splitPane`'s `createPane` synchronous invocation) — the plan names the check to run ("confirm by running the adapter test") rather than marking it TODO. This is intentional: the engineer must verify the existing `keymap.ts` semantics before locking the adapter.

**Type consistency check:** `SubagentEvent` shape is consistent between Task 5 and Task 6 tests. `SubagentPaneManager.open(AttachTarget)` matches across Tasks 4/6/7. `LayoutManagerController.forceFocus` added in Task 4 and consumed in Task 4's adapter. `resolveSubagentConfig` / `resolveConnection` signatures are used identically in Tasks 3 and 7. No name drift found.

## Manual smoke checks (for the implementer / reviewer, not a CI task)

1. Build and install locally per project README, then start OpenCode with the sibyl plugin.
2. Set `SIBYL_SUBAGENT_ENABLED=true` and `SIBYL_SUBAGENT_MAX_PANES=2`.
3. Trigger a subagent via `oh-my-openagent` (or equivalent). Verify a horizontal pane opens showing `opencode attach --mini`.
4. Trigger a second and third subagent — the oldest pane must close automatically (eviction).
5. Let a subagent finish — its pane closes without closing the parent.
6. Restart the TUI with subagents already active — panes restore via start-up resync (FR-4.1).
7. Quit the TUI — no orphan `opencode attach` PTY processes remain (`ps` check; FR-4.4).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-09-subagent-pane-integration.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task; review between tasks; fast iteration. Uses `superpowers:subagent-driven-development`.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`; batch execution with checkpoints.

Which approach?
