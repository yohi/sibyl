# Subagent Pane Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically display and manage subagent sessions (spawned by oh-my-openagent etc.) in Sibyl's own OpenTUI-based panes — without tmux — including lifecycle-driven auto-close, pane-count eviction, and SSE reconnect/resync.

**Architecture:** A new `SubagentLifecycleManager` state machine subscribes to OpenCode events (`session.created/idle/error/deleted`) via the in-process `api.event` bus (default) or direct SSE (`api.client.event.subscribe()`), and drives a new `SubagentPaneAdapter`, which spawns `opencode attach` as a PTY through a `PaneBackend`. Configuration is resolved per-field by `ConfigResolver` (`env > pluginOptions > akane > sibyl` for display settings; `env > akane > sibyl > plugin input` for connection fields). The TUI plugin owns all wiring and disposes everything via `api.lifecycle.onDispose()`.

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
- Config precedence is per-field (not per-block): env > pluginOptions > akane (`akane.experimental.watchdog.subagentDisplay`) > sibyl (`sibyl.subagentDisplay`) for display settings. Connection fields resolve independently as env > akane > sibyl > plugin input, with no fallback after an invalid selected value (spec D-3/D-8).
- Log sanitization: `sessionId` → first 4 chars + `…` (`slice(0,4)+"…"`); error text truncated to 200 chars; raw username/password values never logged (spec §5/§8).

---

## File Structure

New files (one clear responsibility each):

- `src/subagent-validation.ts` — pure validators: `parseMaxPanesValue`, `validateServerUrl`, `validateSessionId`.
- `src/subagent-logger.ts` — `SubagentLogger` interface + pure `sanitizeSessionId` / `truncate` helpers.
- `src/subagent-config.ts` — `ConfigResolver`: `resolveSubagentConfig(pluginOptions, hostConfig, env)` + `resolveConnection(pluginInput, hostConfig, env)`. Pure, DI-testable.
- `src/subagent-types.ts` — `SubagentLikeSession` (structural subtype of SDK `Session`: `id`,`parentID?`,`time.created`), `SubagentSessionClient` (SDK-client subset), `AttachTarget`, `SubagentPaneManager` interfaces, `SubagentConfig`, `ResolvedConnection`.
- `src/subagent-attach-args.ts` — pure `buildAttachPtyOptions(target, auth, directory)` + `isWindows()`; also (later) `buildSseHeaders`.
- `src/subagent-pane-adapter.ts` — `SubagentPaneAdapter` (implements `SubagentPaneManager`): idempotent open/close, argv-spawn via `PaneBackend`+`PtyManager`.
- `src/subagent-event-source.ts` — `SubagentEventSource` interface, `TuiEventBusSource` (default, wraps `api.event`), `SseEventSource` (wraps `api.client.event.subscribe()`, Authorization header, retry+resync hook).
- `src/subagent-lifecycle-manager.ts` — `SubagentLifecycleManager` state machine: event routing, maxPanes/evict, per-session close-once, async serialization, `session.list()` pull-resync, `stop()` cleanup.
- `src/subagent-integration.ts` — `createDefaultAttachTarget`, `createOpenTuiSubagentPaneManager`, `attachSubagentIntegration(api, options)` — wires the above; returns handle (`enabled`, `stop`, `resyncNow`). Testable per-field without TUI coupling.

Modified files:

- `src/layout-manager.tsx` — add `readonly forceFocus: (id: PaneId) => void` and make `splitPane` accept an optional synchronous `createPane` callback; `forceFocus` delegates to `setFocusedId`.
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
      ["https://alice:secret@example.com", false],
      ["http://alice@example.com", false],
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
    if (parsed.username.length > 0 || parsed.password.length > 0) return false;
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
- Produces (used by Tasks 3/4/5/6/7): `export interface SubagentLogger { info(m: string): void; warn(m: string): void; error(m: string): void; }`; `export const consoleSubagentLogger: SubagentLogger`; `export function sanitizeSessionId(id: string): string`; `export function truncate(text: string, max = 200): string`; `export function sanitizeError(error: unknown): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/subagent-logger.test.ts
import { describe, expect, test } from "bun:test";
import { sanitizeError, sanitizeSessionId, truncate } from "../src/subagent-logger";

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
    expect(truncate("x".repeat(250), 200)).toBe(`${"x".repeat(197)}...`);
  });
});

describe("sanitizeError", () => {
  test("removes URL credentials and caps the final message at 200 characters", () => {
    const message = sanitizeError(
      new Error(`connect https://alice:secret@example.test/path ${"x".repeat(300)}`),
    );
    expect(message).not.toContain("alice");
    expect(message).not.toContain("secret");
    expect(message.length).toBeLessThanOrEqual(200);
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
  if (max < 3) return text.slice(0, Math.max(0, max));
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

export function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutCredentials = raw
    .replace(/https?:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s]+/gi, "[redacted-url]")
    .replace(/\b(password|token|secret|authorization)=\S+/gi, "$1=[redacted]");
  return truncate(withoutCredentials);
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
- Produces (used by Tasks 4/6/7): `export interface SubagentConfig { enabled: boolean; maxPanes: number }`; `export interface ResolvedConnection { serverUrl: string; directory: string; username?: string | undefined; password?: string | undefined }`; `export interface SubagentPluginOptions { enabled?: unknown; maxPanes?: unknown }`; `export function resolveSubagentConfig(args: { pluginOptions?: SubagentPluginOptions | undefined; hostConfig: SdkConfig; env: Record<string, string | undefined>; logger: SubagentLogger }): SubagentConfig`; `export function resolveConnection(args: { pluginInput: { serverUrl?: string | undefined; directory?: string | undefined }; hostConfig: SdkConfig; env: Record<string, string | undefined>; logger: SubagentLogger }): ResolvedConnection`.

**Behavior contract (spec D-3/D-8/§6.2, FR-2.1):**
For each display field (`enabled`, `maxPanes`), pick candidate in order **env → pluginOptions → akane → sibyl**; use the *first defined* candidate. If the chosen candidate is invalid → log a sanitize-safe error and throw (no fallback). If no candidate is defined → default. `SIBYL_SUBAGENT_ENABLED` env values `"1"/"true"/"yes"` → true, `"0"/"false"/"no"` → false. A defined but unrecognized value such as `"maybe"`, including values from pluginOptions/host config, is invalid and must throw. `SIBYL_SUBAGENT_MAX_PANES` is parsed via `Number()` then `parseMaxPanesValue`. akane block: `hostConfig.akane?.experimental?.watchdog?.subagentDisplay`; sibyl block: `hostConfig.sibyl?.subagentDisplay` (read via `unknown` narrowing — `SdkConfig` has no `akane`/`sibyl` index).
For `serverUrl` and `directory`, resolve each field independently from **env → akane → sibyl → plugin input**. Read akane connection values from `akane.experimental.watchdog.subagentDisplay.serverUrl` / `.directory` and sibyl values from `sibyl.subagentDisplay.serverUrl` / `.directory`. A defined selected value that is empty, non-string, or an invalid URL is an error and never falls through to a lower layer. Credentials remain env-only.

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

  test("pluginOptions override akane and sibyl per field", () => {
    const pluginOptions = { enabled: true, maxPanes: 7 };
    const hostConfig = {
      akane: { experimental: { watchdog: { subagentDisplay: { enabled: false, maxPanes: 3 } } } },
      sibyl: { subagentDisplay: { enabled: false, maxPanes: 2 } },
    } as never;
    expect(
      resolveSubagentConfig({ pluginOptions, hostConfig, env: {}, logger }),
    ).toEqual({ enabled: true, maxPanes: 7 });
  });

  test("invalid first-defined enabled value throws instead of falling back", () => {
    const hostConfig = { sibyl: { subagentDisplay: { enabled: true } } } as never;
    expect(() =>
      resolveSubagentConfig({ pluginOptions: { enabled: "maybe" }, hostConfig, env: {}, logger }),
    ).toThrow();
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
        hostConfig: {},
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

  test("serverUrl and directory resolve independently through akane then sibyl", () => {
    const hostConfig = {
      akane: { experimental: { watchdog: { subagentDisplay: { serverUrl: "http://akane" } } } },
      sibyl: { subagentDisplay: { directory: "/sibyl" } },
    } as never;
    expect(
      resolveConnection({
        pluginInput: { serverUrl: "http://input", directory: "/input" },
        hostConfig,
        env: {},
        logger,
      }),
    ).toMatchObject({ serverUrl: "http://akane", directory: "/sibyl" });
  });

  test("invalid selected akane serverUrl does not fall back to sibyl", () => {
    const hostConfig = {
      akane: { experimental: { watchdog: { subagentDisplay: { serverUrl: "ftp://akane" } } } },
      sibyl: { subagentDisplay: { serverUrl: "http://sibyl" } },
    } as never;
    expect(() =>
      resolveConnection({ pluginInput: {}, hostConfig, env: {}, logger }),
    ).toThrow();
  });

  test("invalid OPENCODE_SERVER_URL throws", () => {
    expect(() =>
      resolveConnection({
        pluginInput: {},
        hostConfig: {},
        env: { OPENCODE_SERVER_URL: "ftp://x" },
        logger,
      }),
    ).toThrow();
  });

  test("empty serverUrl and empty directory throw", () => {
    expect(() =>
      resolveConnection({ pluginInput: { serverUrl: "", directory: "" }, hostConfig: {}, env: {}, logger }),
    ).toThrow();
  });

  test("username/password pass through from env", () => {
    expect(
      resolveConnection({
        pluginInput: { serverUrl: "http://a", directory: "/d" },
        hostConfig: {},
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

export interface SubagentPluginOptions {
  enabled?: unknown;
  maxPanes?: unknown;
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
  serverUrl?: unknown;
  directory?: unknown;
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

type ParsedBool = boolean | "invalid" | undefined;

function parseBool(v: unknown): ParsedBool {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const l = v.toLowerCase();
    if (l === "1" || l === "true" || l === "yes") return true;
    if (l === "0" || l === "false" || l === "no") return false;
  }
  return "invalid";
}

function resolveBool(candidates: readonly unknown[], logger: SubagentLogger): boolean {
  for (const raw of candidates) {
    const parsed = parseBool(raw);
    if (parsed === undefined) continue;
    if (parsed === "invalid") {
      logger.error("[subagent] invalid enabled configured");
      throw new Error("subagentDisplay.enabled: expected a boolean");
    }
    return parsed;
  }
  return false;
}

function resolveString(
  candidates: readonly unknown[],
  field: "serverUrl" | "directory",
  logger: SubagentLogger,
): string {
  for (const raw of candidates) {
    if (raw === undefined) continue;
    if (typeof raw !== "string" || raw.length === 0) {
      logger.error(`[subagent] ${field} is missing or invalid`);
      throw new Error(`${field} must be a non-empty string`);
    }
    return raw;
  }
  return "";
}

export function resolveSubagentConfig(args: {
  pluginOptions?: SubagentPluginOptions | undefined;
  hostConfig: SdkConfig;
  env: Record<string, string | undefined>;
  logger: SubagentLogger;
}): SubagentConfig {
  const { hostConfig, env, logger } = args;
  const akane = readBlock(hostConfig, "akane");
  const sibyl = readBlock(hostConfig, "sibyl");

  // enabled: env > pluginOptions > akane > sibyl > default(false)
  const enabled = resolveBool(
    [env.SIBYL_SUBAGENT_ENABLED, args.pluginOptions?.enabled, akane.enabled, sibyl.enabled],
    logger,
  );

  // maxPanes: env > pluginOptions > akane > sibyl > default(4)
  const candidates: Array<unknown> = [
    env.SIBYL_SUBAGENT_MAX_PANES,
    args.pluginOptions?.maxPanes,
    akane.maxPanes,
    sibyl.maxPanes,
  ];
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
  hostConfig: SdkConfig;
  env: Record<string, string | undefined>;
  logger: SubagentLogger;
}): ResolvedConnection {
  const akane = readBlock(args.hostConfig, "akane");
  const sibyl = readBlock(args.hostConfig, "sibyl");
  // Each field resolves independently. Once a defined candidate is selected,
  // validation failure throws instead of falling through to a lower layer.
  const serverUrl = resolveString(
    [args.env.OPENCODE_SERVER_URL, akane.serverUrl, sibyl.serverUrl, args.pluginInput.serverUrl],
    "serverUrl",
    args.logger,
  );
  const directory = resolveString(
    [args.env.OPENCODE_PROJECT_DIR, akane.directory, sibyl.directory, args.pluginInput.directory],
    "directory",
    args.logger,
  );
  if (!validateServerUrl(serverUrl)) {
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
git commit -m "feat: ConfigResolver（env > pluginOptions > akane > sibyl の項目単位解決）を追加"
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
  - `src/subagent-types.ts`: `export interface SubagentLikeSession { id: string; parentID?: string | undefined; time: { created: number } }`; `export interface SubagentSessionClient { list(signal?: AbortSignal): Promise<SubagentLikeSession[]> }`; `export interface AttachTarget { sessionId: string; createdAt: number }`; `export interface SubagentPaneManager { open(target: AttachTarget): Promise<void>; close(sessionId: string): Promise<void>; listOpen(): string[]; }`.
  - `src/subagent-attach-args.ts`: `export function isWindows(): boolean`; `export function resolveOpencodeCommand(): string`; `export function buildAttachPtyOptions(args: { target: AttachTarget; serverUrl: string; directory: string; username?: string | undefined; password?: string | undefined }): PtyOptions`.
- `src/subagent-pane-adapter.ts`: `export class SubagentPaneAdapter implements SubagentPaneManager` with `constructor(args: { layout: LayoutManagerController; paneBackend: PaneBackend; ptyManager: PtyManager; serverUrl: string; directory: string; username?: string | undefined; password?: string | undefined; logger: SubagentLogger })`.
  - `src/layout-manager.tsx`: `LayoutManagerController` gains `readonly forceFocus: (id: PaneId) => void`.

**Behavior contract:**
- `buildAttachPtyOptions` returns `command: "opencode.cmd"` on Windows (`process.platform === "win32"`) else `"opencode"`; `args` exactly `["attach", serverUrl, "--session", sessionId, "--dir", directory, "--mini"]` (positional `serverUrl` first, spec FR-1.4); `cwd: directory`; `env` contains **only** `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD` when defined (other vars are merged downstream by `PtyManager.spawn`, which spreads `process.env` — do NOT set credentials elsewhere). `env` values are `string`; use `Record<string, string>` cast via explicit per-key assignment (no `as any`). Never `-u`/`-p`.
- `SubagentPaneAdapter.open` is idempotent per `sessionId`: repeat call with an open pane is a no-op. It builds options, validates the session and server URL, and resolves the PTY handle inside one `try/catch` so invalid input and spawn failures are logged (sanitized) and do not reject `open()`. After successful spawn it calls `layout.splitPane("horizontal", ptyOptions, createPane)` — `createPane` comes from `paneBackend.create` — then transfers the returned handle through `await layout.onPtyReady(newPaneId, spawnedHandle)` before calling `layout.forceFocus(newPaneId)`. If layout creation does not produce a pane, it terminates the already-spawned handle and does not leave it discarded. The layout callback must be synchronous and must not cause a second spawn (spec FR-1.3).
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

  test("unsupported server URL throws before constructing attach args", () => {
    expect(() =>
      buildAttachPtyOptions({
        target: { sessionId: "ses-123", createdAt: 1 },
        serverUrl: "ftp://localhost:3000",
        directory: "/repo",
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

function makeLayout(
  spawned: PtyOptions[],
  forceFocused: string[],
  createdIds: string[] = [],
  readyHandles: string[] = [],
): LayoutManagerController {
  const noop = () => {};
  return {
    model: (() => ({})) as never,
    focusedId: () => "root-pane",
    splitPane: (_direction, ptyOptions, createPane) => {
      spawned.push(ptyOptions);
      const created = createPane?.(ptyOptions);
      if (created !== undefined) createdIds.push(created.id);
    },
    closePane: async () => {},
    focusNext: noop,
    focusPrev: noop,
    onPtyReady: async (_paneId, handle) => {
      readyHandles.push(handle.id);
    },
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
    const readyHandles: string[] = [];
    const logger: SubagentLogger = { info: () => {}, warn: () => {}, error: () => {} };
    const { backend } = makeBackend();
    const ptyManager = {
      spawn: async (o: PtyOptions) => fakePtyHandle(`pty-${spawned.length + 1}`),
      terminate: async () => {},
      terminateAll: async () => {},
    } as unknown as PtyManager;
    const adapter = new SubagentPaneAdapter({
      layout: makeLayout(spawned, forceFocused, [], readyHandles),
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
    expect(readyHandles).toEqual(["pty-1"]);
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

  test("open logs invalid session input and resolves without spawning", async () => {
    const warnings: string[] = [];
    const logger: SubagentLogger = { info: () => {}, warn: (m) => warnings.push(m), error: () => {} };
    const { backend } = makeBackend();
    const ptyManager = {
      spawn: async () => fakePtyHandle("unused"),
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
    await adapter.open({ sessionId: "bad;id", createdAt: 1 });
    expect(warnings).toHaveLength(1);
    expect(adapter.listOpen()).toEqual([]);
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
import { validateServerUrl, validateSessionId } from "./subagent-validation.js";
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
  if (!validateServerUrl(args.serverUrl)) {
    throw new Error("attach: invalid server URL");
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
readonly splitPane: (
  direction: SplitDirection,
  newPtyOptions: PtyOptions,
  createPane?: (options: PtyOptions) => PaneModel,
) => void;
readonly forceFocus: (id: PaneId) => void;

// in createLayoutManagerController return object (after focusPane: setFocusedId)
forceFocus: setFocusedId,
```

Update the controller implementation so `splitPane` forwards the callback as
the fifth argument to `splitPaneInTree`. The callback is invoked synchronously
within the same call stack and its returned `PaneModel` is the pane subsequently
used by the layout. Update the `makeLayout` test fake to invoke the callback and
retain the returned pane id independently from the `forceFocus` assertions.

- [ ] **Step 8: Implement `src/subagent-pane-adapter.ts`**

```ts
import type { LayoutManagerController } from "./layout-manager.js";
import type { PaneBackend } from "./pane-backend.js";
import type { PtyManager } from "./pty-manager.js";
import { buildAttachPtyOptions } from "./subagent-attach-args.js";
import type { SubagentLogger } from "./subagent-logger.js";
import { sanitizeSessionId, sanitizeError } from "./subagent-logger.js";
import type { AttachTarget, SubagentPaneManager } from "./subagent-types.js";
import type { PaneModel } from "./types.js";
```

Note: capture the pane via the `createPane` callback supplied to `layout.splitPane(direction, options, createPane)`. `splitPane` calls `createPane(newPtyOptions)` synchronously inside; store the returned `PaneModel.id`:

```ts
// src/subagent-pane-adapter.ts (full)
import type { LayoutManagerController } from "./layout-manager.js";
import type { PaneBackend } from "./pane-backend.js";
import type { PtyManager } from "./pty-manager.js";
import { sanitizeError, sanitizeSessionId } from "./subagent-logger.js";
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
    try {
      const ptyOptions = buildAttachPtyOptions({
        target,
        serverUrl,
        directory,
        username,
        password,
      });
      // Resolve the PTY handle BEFORE mutating layout, then transfer it to
      // LayoutManager ownership so Pane reuses it instead of spawning twice.
      const spawnedHandle = await paneBackend.spawn(ptyManager, ptyOptions);
      let created: PaneModel | undefined;
      layout.splitPane("horizontal", ptyOptions, (options) => {
        created = paneBackend.create(options);
        return created;
      });
      if (created === undefined) {
        await paneBackend.terminate(ptyManager, spawnedHandle.id);
        return;
      }
      await layout.onPtyReady(created.id, spawnedHandle);
      layout.forceFocus(created.id);
      this.paneBySession.set(target.sessionId, created.id);
    } catch (error) {
      logger.warn(
        `[subagent] attach failed for ${sanitizeSessionId(target.sessionId)}: ${sanitizeError(error)}`,
      );
      return;
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

The implementation must not add a delayed tree scan or a second PTY spawn: the
third `createPane` callback is synchronous by contract, and the returned pane id
is the only id used for handle transfer and focus.

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
  - `export interface SubagentEventSource { start(): void; stop(): Promise<void>; onEvent(handler: (event: SubagentEvent) => void): void; onReconnectRequired(handler: () => Promise<void> | void): void; }`.
  - `export class TuiEventBusSource implements SubagentEventSource` — constructor `({ eventBus, logger }: { eventBus: TuiEventBusLike; logger: SubagentLogger })`; `TuiEventBusLike` is a structural subset `{ on(type, handler): () => void; off?(type, handler): void }`.
  - `export function buildSseHeaders(auth: { username?: string | undefined; password?: string | undefined }): Record<string, string>`.
  - `export class SseEventSource implements SubagentEventSource` — constructor `({ subscribe, listSessions, auth, logger, sleep, lifecycleSignal }: SseDeps)`.

**Behavior contract:**
- `TuiEventBusSource.start()` subscribes to four SDK event types: `"session.created"`, `"session.idle"`, `"session.error"`, `"session.deleted"`; filters `session.created`/`session.deleted` events to `properties.info.parentID != null` before emitting; maps `session.idle` → `subagent.idle` (with `sessionID`), `session.error` → `subagent.error` (with optional `sessionID` — never throws when absent, spec FR-3.2).
- `buildSseHeaders` returns `{}` when no password; `{ Authorization: "Basic <base64(u:p)>" }` otherwise (`Buffer.from(`${u ?? ""}:${p}`).toString("base64")`); result never contains the raw password.
- `SseEventSource.start()` opens a background loop calling `deps.subscribe(signal)` (an injectable wrapper around `client.event.subscribe({ signal })`); iterates `stream` with `for await`; on stream end or error: dispatch every `onReconnectRequired` handler and await its resync promise before calculating or awaiting the exponential backoff sleep. `stop()` sets `stopped`, aborts an `AbortController` connected to the lifecycle signal, and awaits the loop. The retry sleep also receives the same signal. `AbortError` caused by shutdown is normal completion and is not logged. `maxAttempts` is unlimited (continuous operation); each event is converted via the same mapping as `TuiEventBusSource`; after each reconnect, also call `listSessions(signal)` and emit `subagent.created` for each `parentID != null` session returned (this realises spec FR-4.2's in-band resync trigger — the lifecycle manager additionally pulls at start/reconnect for authority).

- [ ] **Step 1: Write the failing test**

```ts
// tests/subagent-event-source.test.ts
import { describe, expect, test } from "bun:test";
import { SseEventSource, TuiEventBusSource, buildSseHeaders } from "../src/subagent-event-source";
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

describe("SseEventSource lifecycle", () => {
  test("dispatches reconnect/resync before retry delay", async () => {
    const order: string[] = [];
    const source = new SseEventSource({
      subscribe: async () => ({ stream: (async function* () {})() }),
      listSessions: async () => {
        order.push("resync");
        return [];
      },
      auth: {},
      logger,
      sleep: async (_ms, signal) => {
        order.push("delay");
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("stop"), { name: "AbortError" })),
            { once: true },
          ),
        );
      },
    });
    source.onReconnectRequired(async () => {
      order.push("notify");
    });
    source.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await source.stop();
    expect(order.slice(0, 3)).toEqual(["notify", "resync", "delay"]);
  });

  test("stop aborts an in-flight subscribe and treats AbortError as normal", async () => {
    let aborted = false;
    const source = new SseEventSource({
      subscribe: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
      listSessions: async () => [],
      auth: {},
      logger,
      sleep: async () => {},
    });
    source.start();
    await source.stop();
    expect(aborted).toBe(true);
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
import { sanitizeError, sanitizeSessionId } from "./subagent-logger.js";

export type SubagentEvent =
  | { type: "subagent.created"; session: SubagentLikeSession }
  | { type: "subagent.idle"; sessionId: string }
  | { type: "subagent.error"; sessionId?: string | undefined }
  | { type: "subagent.deleted"; sessionId: string };

export interface SubagentEventSource {
  start(): void;
  stop(): Promise<void>;
  onEvent(handler: (event: SubagentEvent) => void): void;
  onReconnectRequired(handler: () => Promise<void> | void): void;
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

  onReconnectRequired(_handler: () => Promise<void> | void): void {
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
  subscribe(signal: AbortSignal): Promise<{ stream: AsyncGenerator<unknown, void, unknown> }>;
  listSessions(signal: AbortSignal): Promise<SubagentLikeSession[]>;
  auth: { username?: string | undefined; password?: string | undefined };
  logger: SubagentLogger;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  lifecycleSignal?: AbortSignal;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export class SseEventSource implements SubagentEventSource {
  private handlers: Array<(e: SubagentEvent) => void> = [];
  private reconnectHandlers: Array<() => void> = [];
  private stopped = false;
  private loopPromise: Promise<void> | undefined;
  private abortController: AbortController | undefined;

  constructor(private readonly deps: SseDeps) {}

  start(): void {
    this.stopped = false;
    const controller = new AbortController();
    this.abortController = controller;
    const lifecycleSignal = this.deps.lifecycleSignal;
    if (lifecycleSignal?.aborted) controller.abort();
    else {
      lifecycleSignal?.addEventListener(
        "abort",
        () => this.abortController?.abort(),
        { once: true },
      );
    }
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abortController?.abort();
    await this.loopPromise;
  }

  onEvent(handler: (event: SubagentEvent) => void): void {
    this.handlers.push(handler);
  }

  onReconnectRequired(handler: () => Promise<void> | void): void {
    this.reconnectHandlers.push(handler);
  }

  private async runLoop(): Promise<void> {
    let attempt = 0;
    const signal = this.abortController?.signal ?? new AbortController().signal;
    while (!this.stopped) {
      try {
        const { stream } = await this.deps.subscribe(signal);
        attempt = 0;
        for await (const raw of stream) {
          if (this.stopped) return;
          this.emitMapped(raw);
        }
      } catch (error) {
        if (this.stopped && isAbortError(error)) return;
        if (this.stopped) return;
        this.deps.logger.warn(
          `[subagent] SSE stream error: ${sanitizeError(error)}`,
        );
      }
      if (this.stopped) return;
      for (const h of this.reconnectHandlers) await h();
      if (this.stopped) return;
      try {
        const sessions = await this.deps.listSessions(signal);
        for (const s of sessions) {
          if (s.parentID != null) this.emit({ type: "subagent.created", session: s });
        }
      } catch (error) {
        if (this.stopped && isAbortError(error)) return;
        if (this.stopped) return;
        this.deps.logger.warn(
          `[subagent] resync listSessions failed: ${sanitizeError(error)}`,
        );
      }
      if (this.stopped) return;
      const delay = 500 * 2 ** Math.min(attempt, 6);
      try {
        await this.deps.sleep(delay, signal);
      } catch (error) {
        if (this.stopped && isAbortError(error)) return;
        throw error;
      }
      attempt += 1;
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
- If `config.enabled === false` and `config.maxPanes !== 0` → `start()` is a no-op; if `config.maxPanes === 0`, `start()` closes all open panes even when disabled. `stop()` is safe before `start()`.
- `start()`: marks event intake active, subscribes to events (queue), calls `resyncNow()`, and awaits the queue drain before returning. The queue guarantees per-session ordering and serializes open/close (no races between `session.list()` pull and live events).
- On `subagent.created`: skip if not `validateSessionId(session.id)`; skip duplicates; if `paneManager.listOpen().length >= config.maxPanes` → evict first: pick the open session with the smallest `AttachTarget.createdAt`, call `paneManager.close(oldestId)` before opening the new one. Then `paneManager.open({ sessionId, createdAt })` and record in `openTargets`.
- On `subagent.idle`/`subagent.error(id)`/`subagent.deleted`: close the pane and drop the tracking record. Close-once per session: a second event for an already-removed session is a no-op.
- On `subagent.error` with undefined sessionId: log only (already handled upstream).
- `resyncNow()`: calls `sessionClient.list()`; for every server session with `parentID != null` that is not currently tracked → emit `subagent.created` into the queue. For every tracked session not present in the server list → emit `subagent.deleted`. (Idempotent: repeat calls converge.)
- `stop()`: first disables event intake, awaits the active drain, then attempts every id returned by `paneManager.listOpen()` independently (one rejection must not prevent later closes), clears `openTargets` after all attempts, and finally awaits `eventSource.stop()`. The queue is discarded only after drain completion.
- If `config.maxPanes === 0`, `start()` closes every currently open pane regardless of `config.enabled`; if `config.enabled === false` with a nonzero limit, it returns without starting the event source. `resyncNow()` and `start()` both await the drain barrier before resolving.
- Reconnect hook: registers `eventSource.onReconnectRequired(() => this.resyncNow())` at construction so SSE can await notification-driven resync before backoff.
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

  test("maxPanes=0 closes all existing panes even when enabled=false", async () => {
    const { source, emit } = makeSource();
    const { pane, opened, closed } = makePane();
    // pre-populate one "existing" pane via the pane manager itself
    await pane.open({ sessionId: "pre-1", createdAt: 0 });
    const m = new SubagentLifecycleManager({
      paneManager: pane,
      eventSource: source,
      sessionClient: makeClient([{ id: "pre-1", parentID: "p", time: { created: 0 } }]),
      config: { enabled: false, maxPanes: 0 },
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

  test("stop attempts every open pane when one close rejects", async () => {
    const { source } = makeSource();
    const attempted: string[] = [];
    const pane: SubagentPaneManager = {
      open: async () => {},
      listOpen: () => ["first", "second"],
      close: async (id) => {
        attempted.push(id);
        if (id === "first") throw new Error("first close failed");
      },
    };
    const m = new SubagentLifecycleManager({
      paneManager: pane,
      eventSource: source,
      sessionClient: makeClient([]),
      config: { enabled: true, maxPanes: 4 },
      logger,
    });
    await m.start();
    await m.stop();
    expect(attempted).toEqual(["first", "second"]);
  });

  test("resync: creates unknown child sessions and closes vanished ones", async () => {
    const { source } = makeSource();
    const { pane, opened, closed } = makePane();
    const client = { current: makeClient([
      { id: "child-1", parentID: "root", time: { created: 5 } },
      { id: "root", parentID: undefined, time: { created: 1 } },
    ]) };
    const m = new SubagentLifecycleManager({
      paneManager: pane,
      eventSource: source,
      sessionClient: { list: (signal) => client.current.list(signal) },
      config: { enabled: true, maxPanes: 4 },
      logger,
    });
    await m.start();
    expect(opened.map((o) => o.sessionId)).toContain("child-1");
    // Simulate a second resync with an empty list; resyncNow must await its drain.
    client.current = makeClient([]);
    await m.resyncNow();
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


- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/subagent-lifecycle-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/subagent-lifecycle-manager.ts`**

Serial queue design: a simple `Promise<void>` chain (`this.tail`) into which every handler enqueues its async work. `subagent.created`/`idle`/`error`/`deleted` events push onto the queue; `resyncNow()` computes the diff and pushes the resulting synthesized events onto the same queue (so live events and pulls never interleave out of order). Eviction is performed *inside* the same task that opens a new session (close-then-open within one tick).

```ts
import type { SubagentEvent, SubagentEventSource } from "./subagent-event-source.js";
import type { SubagentLogger } from "./subagent-logger.js";
import { sanitizeError, sanitizeSessionId } from "./subagent-logger.js";
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
  private drainPromise: Promise<void> | undefined;
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
      return this.resyncNow();
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { config, eventSource, paneManager } = this.deps;
    if (config.maxPanes === 0) {
      for (const id of paneManager.listOpen()) {
        try {
          await paneManager.close(id);
        } catch (error) {
          this.deps.logger.warn(`[subagent] maxPanes cleanup failed: ${sanitizeError(error)}`);
        }
      }
      return;
    }
    if (!config.enabled) {
      return;
    }
    eventSource.start();
    await this.resyncNow();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    const { eventSource, paneManager, logger } = this.deps;
    await this.drain();
    const closeResults = await Promise.allSettled(
      paneManager.listOpen().map(async (id) => {
        await paneManager.close(id);
      }),
    );
    for (const result of closeResults) {
      if (result.status === "rejected") {
        logger.warn(`[subagent] error during stop cleanup: ${sanitizeError(result.reason)}`);
      }
    }
    this.openTargets.clear();
    this.queue = [];
    await eventSource.stop();
  }

  async resyncNow(): Promise<void> {
    const { sessionClient, logger } = this.deps;
    let serverChildren: SubagentLikeSession[];
    try {
      const all = await sessionClient.list();
      serverChildren = all.filter((s) => s.parentID != null);
    } catch (error) {
      logger.warn(`[subagent] resync list failed: ${sanitizeError(error)}`);
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
    await this.drain();
  }

  openTargetsForDebug(): ReadonlyMap<string, AttachTarget> {
    return this.openTargets;
  }

  private enqueueEvent(event: SubagentEvent): void {
    if (!this.started) return;
    this.queue.push(() => this.handleEvent(event));
    void this.drain();
  }

  private drain(): Promise<void> {
    if (this.drainPromise !== undefined) return this.drainPromise;
    this.drainPromise = (async () => {
      for (;;) {
        const job = this.queue.shift();
        if (job === undefined) return;
        await job();
      }
    })().finally(() => {
      this.drainPromise = undefined;
    });
    return this.drainPromise;
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
      this.deps.logger.warn(`[subagent] event handler error: ${sanitizeError(error)}`);
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
- Consumes: everything from Tasks 3-6; `TuiPluginApi` (type from `@opencode-ai/plugin/tui`); `LayoutManagerController` (existing); `PtyManager` (existing); `PaneBackend` (existing).
- Produces:
  - `export interface SubagentIntegrationOptions { enabled?: boolean; maxPanes?: number }` (pluginOptions are the second layer: env > pluginOptions > akane > sibyl; `undefined` fields defer to lower layers).
  - `export interface SubagentIntegrationHandle { enabled: boolean; stop(): Promise<void>; resyncNow(): Promise<void>; manager?: SubagentLifecycleManager }`.
  - `export function createDefaultAttachTarget(session: SubagentLikeSession): AttachTarget`.
  - `export function createOpenTuiSubagentPaneManager(args: { layout: LayoutManagerController; ptyManager: PtyManager; paneBackend: PaneBackend; serverUrl: string; directory: string; username?: string | undefined; password?: string | undefined; logger: SubagentLogger }): SubagentPaneManager` (thin wrapper over `SubagentPaneAdapter`).
  - `export function attachSubagentIntegration(api: TuiPluginApi, options: SubagentIntegrationOptions, deps: { layout: LayoutManagerController; ptyManager: PtyManager; paneBackend: PaneBackend; logger?: SubagentLogger; env?: Record<string, string | undefined> }): Promise<SubagentIntegrationHandle>`.

**Behavior contract:**
- Env defaults to `process.env`; logger defaults to `consoleSubagentLogger`.
- Passes `options` directly as `pluginOptions` to `resolveSubagentConfig`; never rewrites plugin options into env because that would make their precedence indistinguishable from env and would hide the selected layer in tests.
- Reads `hostConfig` from `api.state.config`. Reads `pluginInput` fields as `{ serverUrl: undefined, directory: api.state.path.directory }`; connection resolution also reads the akane/sibyl connection fields independently. Register `sibyl.toggleSubagentDisplay` before any disabled early return. When `config.enabled === false` and `config.maxPanes !== 0`, return `{ enabled: false, stop: async () => {}, resyncNow: async () => {} }` after registration; when `config.maxPanes === 0`, still construct the lifecycle manager and run its start cleanup so existing panes are closed regardless of `enabled`.
- Event-source selection: default `TuiEventBusSource({ eventBus: api.event })`. Only use `SseEventSource` when an env flag is explicitly set (e.g., `SIBYL_SUBAGENT_SSE=1`); construct it with `subscribe(signal) => api.client.event.subscribe({ signal })`, `listSessions(signal)`, an abort-aware sleep, `lifecycleSignal: api.lifecycle.signal`, auth, and logger. The SSE source must dispatch and await reconnect handlers before calculating or awaiting retry delay.
- Registers `api.lifecycle.onDispose(() => manager.stop())` so FR-4.4 is guaranteed on TUI shutdown. Lifecycle cleanup disables event intake, awaits queue drain, attempts all pane closes independently, clears tracking, then stops the event source.
- Registers `sibyl.toggleSubagentDisplay` command before the disabled return; the command's `run` is a no-op when `enabled === false`, otherwise logs an info message via `logger.info("[subagent] toggle is config-driven at startup")` (kept minimal; toggling persistence is out of scope).

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
  test("enabled=false (default) → disabled handle and registered no-op toggle", async () => {
    const { api, layers } = makeApi({});
    const handle = await attachSubagentIntegration(api, {}, {
      layout,
      paneBackend: backend,
      ptyManager,
      env: {},
    });
    expect(handle.enabled).toBe(false);
    const toggle = (layers[0] as { commands: Array<{ name: string; run: () => unknown }> }).commands.find(
      (command) => command.name === "sibyl.toggleSubagentDisplay",
    );
    expect(toggle).toBeDefined();
    await toggle?.run();
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

  test("options.enabled=true overrides akane/sibyl but not an explicit env value", async () => {
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

  test("explicit env value beats pluginOptions", async () => {
    const { api } = makeApi({});
    const handle = await attachSubagentIntegration(api, { enabled: true }, {
      layout,
      paneBackend: backend,
      ptyManager,
      env: {
        SIBYL_SUBAGENT_ENABLED: "false",
        OPENCODE_SERVER_URL: "http://x",
        OPENCODE_PROJECT_DIR: "/d",
      },
    });
    expect(handle.enabled).toBe(false);
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
import type { PaneBackend } from "./pane-backend.js";
import type { PtyManager } from "./pty-manager.js";
import { resolveConnection, resolveSubagentConfig } from "./subagent-config.js";
import { SubagentPaneAdapter } from "./subagent-pane-adapter.js";
import { SubagentLifecycleManager } from "./subagent-lifecycle-manager.js";
import { TuiEventBusSource, SseEventSource } from "./subagent-event-source.js";
import { consoleSubagentLogger } from "./subagent-logger.js";
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
  const env: Record<string, string | undefined> = { ...rawEnv };

  const hostConfig = api.state.config as SdkConfig;
  const config = resolveSubagentConfig({ pluginOptions: options, hostConfig, env, logger });
  api.keymap.registerLayer({
    commands: [
      {
        name: "sibyl.toggleSubagentDisplay",
        title: "Toggle Subagent Display",
        desc: "Subagent display is configured at startup; edit config to toggle.",
        category: "Plugin",
        run: () => {
          if (!config.enabled || config.maxPanes === 0) return;
          logger.info("[subagent] toggle is config-driven at startup");
        },
      },
    ],
    bindings: [],
  });
  if (!config.enabled && config.maxPanes !== 0) {
    return {
      enabled: false,
      stop: async () => {},
      resyncNow: async () => {},
    };
  }

  const connection = resolveConnection({
    pluginInput: { serverUrl: undefined, directory: api.state.path.directory },
    hostConfig,
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
    list: async (_signal) => {
      const result = await api.client.session.list();
      const data = (result as { data?: unknown }).data;
      return Array.isArray(data) ? (data as SubagentLikeSession[]) : [];
    },
  };

  const eventSource = useSse
    ? new SseEventSource({
        subscribe: (signal) => api.client.event.subscribe({ signal }),
        listSessions: (signal) => sessionClient.list(signal),
        auth: { username: connection.username, password: connection.password },
        logger,
        lifecycleSignal: api.lifecycle.signal,
        sleep: (ms, signal) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, ms);
            const abort = () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            };
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          }),
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

  return {
    enabled: config.enabled && config.maxPanes > 0,
    stop: () => manager.stop(),
    resyncNow: () => manager.resyncNow(),
    manager,
  };
}

```

- The installed `TuiPluginApi` type must expose `api.lifecycle.signal` for this path. If the SDK declaration omits it, define a local structural lifecycle type with `onDispose` and `signal: AbortSignal`, narrow the incoming API at this boundary, and keep the signal wiring in the integration factory; do not remove the signal or replace it with an unrelated timeout.

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

Change the signature and add a wire-up call before the global PTY cleanup hook so
subagent pane cleanup completes while the pane-owned handles are still available:

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
    // ... existing route/keymap setup unchanged ...
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

All 16 requested findings were rechecked against the revised plan:

1. **URL credentials:** `validateServerUrl` rejects non-empty username/password while retaining HTTP/HTTPS validation; credentialed URL tests were added in Task 1.
2. **`open()` error boundary:** option construction and spawn now share the adapter `try/catch`; invalid session and spawn errors are sanitized and do not reject `open()`.
3. **Direct attach URL validation:** `buildAttachPtyOptions` calls `validateServerUrl`, with an explicit `ftp://` regression test.
4. **`maxPanes === 0`:** lifecycle `start()` closes panes regardless of `enabled`; the test now uses `enabled: false` and verifies closure.
5. **Reconnect ordering:** `SseEventSource` awaits reconnect handlers/resync before calculating and awaiting backoff; an ordering test asserts notification → resync → delay.
6. **Disabled toggle registration:** integration registers `sibyl.toggleSubagentDisplay` before the disabled return; the disabled test finds and runs the no-op command.
7. **`splitPane` callback contract:** the controller contract includes the third synchronous `createPane` argument, forwards it to the tree helper, and the fake invokes/preserves its returned pane id.
8. **`pluginOptions` precedence:** the single policy is now env > pluginOptions > akane > sibyl; tests cover plugin override and explicit env precedence.
9. **PTY ownership:** adapter stores the spawned handle, transfers it through `layout.onPtyReady`, focuses the created pane, and terminates it if layout creation fails; the test asserts handle transfer and one spawn path.
10. **Invalid boolean values:** `parseBool` distinguishes absent, valid, and invalid values; the first defined invalid value throws instead of falling back, with a `"maybe"` test.
11. **Connection resolution:** `resolveConnection` receives `hostConfig`, resolves `serverUrl` and `directory` independently through env → akane → sibyl → plugin input, and never falls back after invalid selection; tests cover both precedence and invalid akane URL.
12. **Drain barriers:** lifecycle `start()`/`resyncNow()` await `drain()`, while `stop()` disables intake, drains, closes panes, clears tracking, and then stops the event source without premature queue discard.
13. **Error sanitization:** `sanitizeError` strips URL credentials/credential-like fields and guarantees final output ≤200 characters; adapter, SSE, and lifecycle logs use it.
14. **Independent cleanup:** `stop()` uses independent close attempts over `paneManager.listOpen()`, logs each rejection, clears tracking after all attempts, and has a one-failure/multiple-pane test.
15. **Unused backend import:** Task 7 consumes `PaneBackend`, removes the `OpenTuiPaneBackend` type import and the value-position sentinel.
16. **SSE cancellation:** subscribe, list, and retry sleep receive an abort signal; lifecycle signal wiring and AbortError-normal shutdown are specified and tested.

**Plan consistency checks:** The revised signatures match across Tasks 3–8 (`SubagentPluginOptions`, `SubagentSessionClient.list(signal?)`, `SseDeps`, `SubagentEventSource`, and `LayoutManagerController.splitPane`). The former delayed-tree-scan alternative and env-synthesis precedence ambiguity were removed. No unresolved `TBD`, `TODO`, or deferred implementation branch remains in the revised code blocks.

**Spec coverage map:** FR-1.1–1.4 → Tasks 1/4; FR-1.2 toggle → Tasks 3/7/8; FR-2.1/2.2 → Tasks 3/6; FR-3.1–3.3 → Tasks 5/6; FR-4.1–4.4 → Tasks 5/6/7; security logging and credentials → Tasks 1/2/4/5/6; configuration precedence and connection resolution → Task 3; integration wiring → Tasks 7/8. Unit tests and manual smoke checks remain part of the implementation handoff.

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
