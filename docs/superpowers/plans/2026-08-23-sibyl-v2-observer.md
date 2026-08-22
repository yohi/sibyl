# Sibyl v2 Observer MVP Implementation Plan

<!-- markdownlint-disable MD013 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch subagents for this work.

**Goal:** Replace Sibyl's PTY-backed multi-pane TUI path with a bounded, read-only `sidebar_content` observer for the direct child sessions of the active OpenCode session.

**Architecture:** Resolve observer configuration once at TUI startup, project OpenCode Session/Message/Part data into a strict safe allowlist, and feed normalized events plus initial snapshots into a parent-scoped `SubagentRegistry`. Render only registry views through a Solid/OpenTUI sidebar slot; the observer path has no route, keymap, PTY, pane backend, attach process, server URL, directory, credential, or Akane dependency.

**Tech Stack:** Bun 1.3.x, TypeScript 7 strict mode, Solid.js, OpenTUI `>=0.4.5 <1`, `@opencode-ai/plugin` and SDK v2 `^1.18.8`, Bun test, Biome, Rollup.

## Global Constraints

- Use Bun for package management, scripts, and tests; do not use npm, pnpm, or Yarn.
- Keep TypeScript strict and do not use `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Register only OpenCode's `sidebar_content` slot for the observer; do not register or navigate to a Sibyl route.
- Do not construct `PtyManager`, `OpenTuiPaneBackend`, layout controllers, shells, `Bun.Terminal`, `node-pty`, or `opencode attach` from the TUI or observer integration path.
- Track only sessions whose `parentID` exactly equals the current slot `session_id`; never recurse into grandchildren.
- Default to `enabled: false`, `maxVisibleSubagents: 8`, `maxTrackedSubagents: 64`, `activityLimit: 5`, `idleRetentionMs: 300_000`, and `true` for every display flag.
- Accept `maxVisibleSubagents` integers from 1 through 8, `maxTrackedSubagents` integers from 8 through 256, `activityLimit` integers from 1 through 20, and `idleRetentionMs` integers from 0 through 3,600,000.
- Reject `maxTrackedSubagents < maxVisibleSubagents`; invalid selected values must not fall through to a lower-precedence source.
- Resolve each option independently as environment variable, then TUI plugin observer option, then `sibyl.observer`, then default.
- Treat legacy display, connection, directory, credential, SSE, and PTY attach settings only as a one-warning-per-startup deprecation signal; discard every legacy value.
- Store and render only safe projected fields. Never store raw reasoning text, tool input, tool `raw`, tool output, tool error, tool title, attachments, metadata, Session metadata, environment variables, authorization values, or API keys.
- Redact allowlisted text before truncating it, and use only the literal `[redacted]` for replacements.
- Keep child entries, pending correlations, message references, part references, and activity history bounded.
- Coalesce event bursts before notifying Solid subscribers and target visible updates within 250 ms.
- Log only static operation identifiers and sanitized error categories; never log raw client errors, event payloads, configuration values, or external response bodies.
- Akane is not loaded, configured, queried, or rendered by this plan.
- Cover every behavior change under `tests/` and run `bun run lint`, `bun run typecheck`, `bun run test`, and `bun run build` before completion.
- Use Japanese Conventional Commit messages; do not commit, push, submit PRs, or merge unless the user explicitly requests those Git operations.

---

## Stacked PR Strategy

Create the stack before implementation so each branch owns one dependency layer:

```text
(main)
  <- observer/config-projection
  <- observer/events-snapshot
  <- observer/registry
  <- observer/sidebar
  <- observer/migration
```

| Stack layer | Tasks | Reviewable outcome |
| --- | --- | --- |
| `observer/config-projection` | 1-2 | Strict observer configuration and secret-safe allowlist projection |
| `observer/events-snapshot` | 3-4 | EventBus/SSE normalization and race-safe snapshot hydration |
| `observer/registry` | 5 | Bounded parent-scoped runtime state, retention, and backpressure |
| `observer/sidebar` | 6-7 | Theme-aware cards and `sidebar_content`-only TUI integration |
| `observer/migration` | 8-9 | Legacy path removal, public surface/docs migration, final acceptance evidence |

When the user authorizes Git operations, initialize and extend the stack with these non-interactive commands. Do not run the merge command; merging is reserved for a human operator.

```bash
gh extension install github/gh-stack
git config rerere.enabled true
git config remote.pushDefault origin

gh stack init observer/config-projection
# Complete Tasks 1-2 and their commits.
gh stack add observer/events-snapshot
# Complete Tasks 3-4 and their commits.
gh stack add observer/registry
# Complete Task 5 and its commits.
gh stack add observer/sidebar
# Complete Tasks 6-7 and their commits.
gh stack add observer/migration
# Complete Tasks 8-9 and their commits.

gh stack submit --auto
gh stack view --json
```

If a lower layer changes after an upper layer exists, check out the owning branch, commit only that concern, then replay the upper stack:

```bash
gh stack checkout observer/config-projection
# Edit, test, stage, and commit only configuration/projection files.
gh stack rebase --upstack
gh stack top
gh stack view --json
```

## File Responsibility Map

### Create

- `src/subagent-redaction.ts`: deterministic secret replacement, safe tool-name validation, and redaction-before-truncation.
- `src/subagent-normalizer.ts`: unknown-input guards and projection from SDK values to the safe observer event/view allowlist.
- `src/subagent-snapshot-reader.ts`: direct-child, status, message, and part hydration through the existing OpenCode client/state APIs.
- `src/subagent-registry.ts`: parent selection, initialization buffering, event application, bounded retention, backpressure, resync, and subscriptions.
- `src/subagent-observer.tsx`: `SidebarObserver` and `SubagentCard` Solid components.
- `tests/subagent-redaction.test.ts`: ordered redaction and truncation fixtures.
- `tests/subagent-normalizer.test.ts`: Session/Message/Part allowlist and fallback fixtures.
- `tests/subagent-snapshot-reader.test.ts`: direct-child hydration, SDK failures, and bounded message reads.
- `tests/subagent-registry.test.ts`: initialization races, status/tool transitions, capacity, retention, resync, and bounds.
- `tests/subagent-observer.test.tsx`: theme-aware, conditional, ordered, scrollable card rendering.

### Modify

- `src/subagent-config.ts`: replace legacy display/connection resolution with observer-only per-field resolution and legacy detection.
- `src/subagent-validation.ts`: replace pane/server/session validators with strict observer boolean/integer validators.
- `src/subagent-types.ts`: replace attach/pane types with normalized observer state and safe projection types.
- `src/subagent-event-source.ts`: normalize every required EventBus/SSE event without connection or credential handling.
- `src/subagent-integration.ts`: wire the source, snapshot reader, registry, slot renderer, and lifecycle cleanup only.
- `src/tui.tsx`: resolve startup configuration and attach the observer without route, keymap, layout, pane, or PTY construction.
- `src/index.ts`: export server-safe observer core APIs and remove legacy subagent attach/lifecycle exports; UI attachment remains on the `./tui` entry.
- `rollup.config.js`: remove the unused server-plugin bundle entry.
- `package.json`: describe the observer and remove the `./server` export.
- `README.md`: document observer installation, configuration, privacy rules, and limitations.
- `SPEC.md`: make the Observer MVP the current product specification and preserve PTY behavior only as historical v1 context.
- `docs/architecture.md`: replace the route/PTY data path with the Registry/sidebar data path.
- `CHANGELOG.md`: add an Unreleased v2 Observer migration entry.
- `tests/subagent-config.test.ts`: defaults, precedence, validation, and discarded legacy settings.
- `tests/subagent-validation.test.ts`: observer value boundaries.
- `tests/subagent-event-source.test.ts`: complete event coverage and SSE reconnect behavior without credentials.
- `tests/subagent-integration.test.ts`: observer-only dependencies, registration, resync, and cleanup.
- `tests/tui.test.ts`: `sidebar_content`-only registration and absence of PTY/route/keymap behavior.
- `tests/index.test.ts`: observer exports and removal of legacy integration exports.

### Delete

- `src/server.ts`: route-command server plugin is no longer part of the TUI-only observer product.
- `src/subagent-attach-args.ts`: no attach command exists in v2 Observer.
- `src/subagent-pane-adapter.ts`: no pane or PTY adapter exists in the observer path.
- `src/subagent-lifecycle-manager.ts`: replaced by `SubagentRegistry`.
- `tests/server.test.ts`: server entry is removed.
- `tests/subagent-attach-args.test.ts`: attach argument behavior is removed.
- `tests/subagent-layout-and-pane-adapter.test.ts`: pane integration behavior is removed.
- `tests/subagent-lifecycle-manager.test.ts`: replaced by Registry tests.

Generic PTY modules and their tests remain in the root library API unless a separate deprecation project removes them. The published TUI bundle must not import or execute them.

---

### Task 1: Resolve Strict Observer Configuration

**Stack layer:** `observer/config-projection`

**Files:**

- Modify: `src/subagent-config.ts`
- Modify: `src/subagent-validation.ts`
- Modify: `tests/subagent-config.test.ts`
- Modify: `tests/subagent-validation.test.ts`

**Interfaces:**

- Consumes: TUI plugin options, `api.state.config`, and the process or injected environment.
- Produces:

```ts
export interface ObserverConfig {
  readonly enabled: boolean;
  readonly maxVisibleSubagents: number;
  readonly maxTrackedSubagents: number;
  readonly activityLimit: number;
  readonly idleRetentionMs: number;
  readonly showModel: boolean;
  readonly showProvider: boolean;
  readonly showLatestText: boolean;
  readonly showReasoningSummary: boolean;
}

export interface ObserverConfigInput {
  readonly enabled?: unknown;
  readonly maxVisibleSubagents?: unknown;
  readonly maxTrackedSubagents?: unknown;
  readonly activityLimit?: unknown;
  readonly idleRetentionMs?: unknown;
  readonly showModel?: unknown;
  readonly showProvider?: unknown;
  readonly showLatestText?: unknown;
  readonly showReasoningSummary?: unknown;
}

export interface ObserverPluginOptions {
  readonly observer?: ObserverConfigInput;
}

export interface ObserverConfigResolution {
  readonly config: ObserverConfig;
  readonly legacySettingsDetected: boolean;
}

export function resolveObserverConfig(args: {
  readonly pluginOptions?: unknown;
  readonly hostConfig: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): ObserverConfigResolution;
```

- Keeps `SubagentValidationError`, with exact messages such as `Invalid observer maxTrackedSubagents`.

- [ ] **Step 1: Replace pane-count validation tests with observer boundaries**

Use table-driven cases that exercise both typed configuration values and environment strings:

```ts
test.each([
  ["maxVisibleSubagents", 1, 1],
  ["maxVisibleSubagents", 8, 8],
  ["maxTrackedSubagents", 8, 8],
  ["maxTrackedSubagents", 256, 256],
  ["activityLimit", 1, 1],
  ["activityLimit", 20, 20],
  ["idleRetentionMs", 0, 0],
  ["idleRetentionMs", 3_600_000, 3_600_000],
] as const)("accepts %s=%p", (name, value, expected) => {
  expect(parseObserverInteger(name, value, false)).toBe(expected);
  expect(parseObserverInteger(name, String(value), true)).toBe(expected);
});

test.each([
  ["enabled", true, "true", "1"],
  ["showModel", false, "false", "0"],
] as const)("accepts strict boolean forms for %s", (name, typed, word, numeric) => {
  expect(parseObserverBoolean(name, typed, false)).toBe(typed);
  expect(parseObserverBoolean(name, word, true)).toBe(typed);
  expect(parseObserverBoolean(name, numeric, true)).toBe(typed);
});

test.each(["yes", "TRUE", " false ", 1, null] as const)(
  "rejects non-contract boolean %p",
  (value) => {
    expect(() => parseObserverBoolean("enabled", value, typeof value === "string")).toThrow(
      "Invalid observer enabled",
    );
  },
);

test.each([
  ["maxVisibleSubagents", 0],
  ["maxVisibleSubagents", 9],
  ["maxTrackedSubagents", 7],
  ["maxTrackedSubagents", 257],
  ["activityLimit", 0],
  ["activityLimit", 21],
  ["idleRetentionMs", -1],
  ["idleRetentionMs", 3_600_001],
  ["activityLimit", 2.5],
  ["activityLimit", "2.5"],
] as const)("rejects %s=%p", (name, value) => {
  expect(() => parseObserverInteger(name, value, typeof value === "string")).toThrow(
    `Invalid observer ${name}`,
  );
});
```

- [ ] **Step 2: Run focused validation tests and observe the legacy API failure**

Run: `bun test tests/subagent-validation.test.ts tests/subagent-config.test.ts`

Expected: FAIL because `parseObserverInteger`, `ObserverConfig`, and `resolveObserverConfig` do not exist yet.

- [ ] **Step 3: Implement strict value parsing and defaults**

Use these exact bounds and defaults:

```ts
export const DEFAULT_OBSERVER_CONFIG: ObserverConfig = {
  enabled: false,
  maxVisibleSubagents: 8,
  maxTrackedSubagents: 64,
  activityLimit: 5,
  idleRetentionMs: 300_000,
  showModel: true,
  showProvider: true,
  showLatestText: true,
  showReasoningSummary: true,
};

const INTEGER_BOUNDS = {
  maxVisibleSubagents: [1, 8],
  maxTrackedSubagents: [8, 256],
  activityLimit: [1, 20],
  idleRetentionMs: [0, 3_600_000],
} as const;

export type ObserverIntegerName = keyof typeof INTEGER_BOUNDS;

export type ObserverBooleanName =
  | "enabled"
  | "showModel"
  | "showProvider"
  | "showLatestText"
  | "showReasoningSummary";

export function parseObserverBoolean(
  name: ObserverBooleanName,
  value: unknown,
  fromEnvironment: boolean,
): boolean {
  if (typeof value === "boolean" && !fromEnvironment) return value;
  if (fromEnvironment && (value === "true" || value === "1")) return true;
  if (fromEnvironment && (value === "false" || value === "0")) return false;
  throw new SubagentValidationError(`observer ${name}`);
}

export function parseObserverInteger(
  name: ObserverIntegerName,
  value: unknown,
  fromEnvironment: boolean,
): number {
  const parsed = fromEnvironment && typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  const [minimum, maximum] = INTEGER_BOUNDS[name];
  if (typeof parsed !== "number" || !Number.isInteger(parsed)) {
    throw new SubagentValidationError(`observer ${name}`);
  }
  if (parsed < minimum || parsed > maximum) {
    throw new SubagentValidationError(`observer ${name}`);
  }
  return parsed;
}

export function validateObserverCapacity(
  maxVisibleSubagents: number,
  maxTrackedSubagents: number,
): void {
  if (maxTrackedSubagents < maxVisibleSubagents) {
    throw new SubagentValidationError("observer maxTrackedSubagents");
  }
}
```

Implement one field selector that records whether its winning value came from the environment. Resolve these exact environment keys:

```ts
const OBSERVER_ENV = {
  enabled: "SIBYL_OBSERVER_ENABLED",
  maxVisibleSubagents: "SIBYL_OBSERVER_MAX_VISIBLE_SUBAGENTS",
  maxTrackedSubagents: "SIBYL_OBSERVER_MAX_TRACKED_SUBAGENTS",
  activityLimit: "SIBYL_OBSERVER_ACTIVITY_LIMIT",
  idleRetentionMs: "SIBYL_OBSERVER_IDLE_RETENTION_MS",
  showModel: "SIBYL_OBSERVER_SHOW_MODEL",
  showProvider: "SIBYL_OBSERVER_SHOW_PROVIDER",
  showLatestText: "SIBYL_OBSERVER_SHOW_LATEST_TEXT",
  showReasoningSummary: "SIBYL_OBSERVER_SHOW_REASONING_SUMMARY",
} as const;
```

Detect property/key presence, but never read a legacy value into observer fields or log it. Inspect these legacy sources: plugin option keys `enabled`, `maxPanes`, `serverUrl`, and `directory`; host paths `sibyl.subagentDisplay` and `akane.experimental.watchdog.subagentDisplay`; and environment keys beginning with `SIBYL_SUBAGENT_` plus `OPENCODE_SERVER_URL`, `OPENCODE_PROJECT_DIR`, `OPENCODE_SERVER_USERNAME`, and `OPENCODE_SERVER_PASSWORD`.

- [ ] **Step 4: Add precedence, cross-field, and legacy-discard fixtures**

```ts
test("resolves every field independently as env over plugin over sibyl.observer over default", () => {
  const result = resolveObserverConfig({
    pluginOptions: { observer: { maxVisibleSubagents: 4, activityLimit: 3 } },
    hostConfig: {
      sibyl: {
        observer: {
          enabled: true,
          maxVisibleSubagents: 2,
          maxTrackedSubagents: 32,
          showProvider: false,
        },
      },
    },
    env: {
      SIBYL_OBSERVER_MAX_TRACKED_SUBAGENTS: "96",
      SIBYL_OBSERVER_SHOW_PROVIDER: "true",
    },
  });

  expect(result.config).toEqual({
    enabled: true,
    maxVisibleSubagents: 4,
    maxTrackedSubagents: 96,
    activityLimit: 3,
    idleRetentionMs: 300_000,
    showModel: true,
    showProvider: true,
    showLatestText: true,
    showReasoningSummary: true,
  });
});

test("detects and discards every legacy source", () => {
  const result = resolveObserverConfig({
    pluginOptions: {
      enabled: true,
      maxPanes: 1,
      serverUrl: "https://legacy.test",
      directory: "/legacy",
    },
    hostConfig: {
      sibyl: { subagentDisplay: { enabled: true, maxPanes: 1 } },
      akane: { experimental: { watchdog: { subagentDisplay: { enabled: true } } } },
    },
    env: {
      SIBYL_SUBAGENT_ENABLED: "true",
      SIBYL_SUBAGENT_MAX_PANES: "1",
      OPENCODE_SERVER_URL: "https://legacy.test",
      OPENCODE_PROJECT_DIR: "/legacy",
      OPENCODE_SERVER_USERNAME: "legacy-user",
      OPENCODE_SERVER_PASSWORD: "must-not-flow",
    },
  });

  expect(result.legacySettingsDetected).toBe(true);
  expect(result.config).toEqual(DEFAULT_OBSERVER_CONFIG);
  expect(JSON.stringify(result)).not.toContain("must-not-flow");
});

test("does not fall through when the selected value is invalid", () => {
  expect(() => resolveObserverConfig({
    pluginOptions: { observer: { activityLimit: 5 } },
    hostConfig: { sibyl: { observer: { activityLimit: 4 } } },
    env: { SIBYL_OBSERVER_ACTIVITY_LIMIT: "0" },
  })).toThrow("Invalid observer activityLimit");
});

test("enforces tracked capacity at or above visible capacity", () => {
  expect(() => validateObserverCapacity(8, 7)).toThrow(
    "Invalid observer maxTrackedSubagents",
  );
  expect(() => validateObserverCapacity(8, 8)).not.toThrow();
  expect(() => validateObserverCapacity(1, 256)).not.toThrow();
});
```

Call `validateObserverCapacity` after all nine fields have been selected and individually parsed. The public ranges already make a mismatch impossible for valid values, but this explicit invariant protects future range changes.

- [ ] **Step 5: Run and pass focused tests**

Run: `bun test tests/subagent-validation.test.ts tests/subagent-config.test.ts`

Expected: PASS with no connection, Akane fallback, or pane-count behavior remaining.

- [ ] **Step 6: Commit the configuration boundary when Git operations are authorized**

```bash
git add src/subagent-config.ts src/subagent-validation.ts tests/subagent-config.test.ts tests/subagent-validation.test.ts
git commit -m "feat: Observer設定を厳格に解決する"
```

### Task 2: Project Only Redacted Allowlisted Data

**Stack layer:** `observer/config-projection`

**Files:**

- Create: `src/subagent-redaction.ts`
- Create: `src/subagent-normalizer.ts`
- Modify: `src/subagent-types.ts`
- Create: `tests/subagent-redaction.test.ts`
- Create: `tests/subagent-normalizer.test.ts`

**Interfaces:**

- Consumes: SDK `Session`, `Message`, `Part`, `SessionStatus`, and unknown SSE payloads only at the adapter boundary.
- Produces safe values only:

```ts
export type ObserverRuntimeStatus = "busy" | "idle" | "retry" | "error" | "unknown";
export type ObserverToolState = "pending" | "running" | "completed" | "error";

export interface SafeSessionProjection {
  readonly id: string;
  readonly parentSessionId?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type SafeModelCandidate =
  | { readonly providerId: string; readonly modelId: string }
  | { readonly providerId?: never; readonly modelId?: never };

export type SafeMessageProjection =
  | ({
      readonly id: string;
      readonly sessionId: string;
      readonly role: "user";
      readonly createdAt: number;
      readonly agentName: string;
    } & SafeModelCandidate)
  | ({
      readonly id: string;
      readonly sessionId: string;
      readonly role: "assistant";
      readonly createdAt: number;
      readonly completedAt?: number;
      readonly hasError: boolean;
    } & SafeModelCandidate);

export interface ObserverToolActivity {
  readonly id: string;
  readonly toolName: string;
  readonly state: ObserverToolState;
  readonly updatedAt: number;
}

export interface SubagentRuntimeView {
  readonly sessionId: string;
  readonly parentSessionId: string;
  readonly agentName: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly status: ObserverRuntimeStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly currentActivity?: ObserverToolActivity;
  readonly recentActivity: readonly ObserverToolActivity[];
  readonly latestAssistantText?: string;
  readonly publicReasoningSummary?: string;
}

export interface ObserverRegistrySnapshot {
  readonly parentSessionId?: string;
  readonly ready: boolean;
  readonly views: readonly SubagentRuntimeView[];
  readonly overflowCount: number;
}
```

- Produces `redactAndTruncate(text: string, maxLength: number): string`, `safeCorrelationId(value: unknown): string | undefined`, `safeDisplayIdentifier(value: unknown): string | undefined`, `safeToolName(value: unknown): string`, `projectSession`, `projectMessage`, `projectPart`, and `normalizeRuntimeStatus`.
- `projectPart` returns only agent, subtask, Assistant text, explicitly public reasoning summary, or tool projections. It never returns raw SDK Part objects.

- [ ] **Step 1: Write deterministic secret fixtures first**

```ts
test.each([
  ["authorization=topsecret", "authorization=[redacted]"],
  ['password: "topsecret"', "password: [redacted]"],
  ["Bearer eyJhbGciOiJIUzI1NiJ9.secret.signature", "Bearer [redacted]"],
  ["Basic YWxpY2U6c2VjcmV0", "Basic [redacted]"],
  ["token=ghp_1234567890abcdefgh", "token=[redacted]"],
  ["OPENAI_API_KEY=sk-1234567890abcdefgh", "OPENAI_API_KEY=[redacted]"],
] as const)("redacts %s", (input, expected) => {
  expect(redactAndTruncate(input, 200)).toBe(expected);
});

test("redacts before truncation", () => {
  const secret = "sk-1234567890abcdefghijklmnopqrstuvwxyz";
  const fullyRedacted = "prefix [redacted] suffix";
  const output = redactAndTruncate(`prefix ${secret} suffix`, 18);
  expect(output).toBe(`${fullyRedacted.slice(0, 17)}…`);
  expect(output).not.toContain(secret.slice(0, 8));
});
```

- [ ] **Step 2: Write allowlist projection tests that contain hostile excluded fields**

```ts
test("projects a tool without inspecting payload, title, output, error, attachments, or metadata", () => {
  const excluded = (field: string): never => {
    throw new Error(`${field}-secret was accessed`);
  };
  const projected = projectPart(
    {
      id: "part-1",
      sessionID: "child",
      messageID: "assistant-1",
      type: "tool",
      callID: "call-1",
      tool: "read",
      get metadata(): never {
        return excluded("part-metadata");
      },
      state: {
        status: "completed",
        time: { start: 10, end: 20 },
        get input(): never {
          return excluded("input");
        },
        get output(): never {
          return excluded("output");
        },
        get title(): never {
          return excluded("title");
        },
        get error(): never {
          return excluded("error");
        },
        get raw(): never {
          return excluded("raw");
        },
        get metadata(): never {
          return excluded("metadata");
        },
        get attachments(): never {
          return excluded("attachment");
        },
      },
    },
    { messageRole: "assistant", observedAt: 20 },
  );

  expect(projected).toEqual({
    kind: "tool",
    sessionId: "child",
    messageId: "assistant-1",
    partId: "part-1",
    activity: { id: "part-1", toolName: "read", state: "completed", updatedAt: 20 },
  });
  expect(JSON.stringify(projected)).not.toMatch(
    /input-secret|output-secret|title-secret|error-secret|raw-secret|metadata-secret|attachment-secret|part-metadata-secret/,
  );
});

test("keeps valid messages when provider and model candidates are unavailable", () => {
  expect(projectMessage({
    id: "assistant-invalid-model",
    sessionID: "child",
    role: "assistant",
    time: { created: 10 },
    providerID: "token=provider-secret",
    modelID: "gpt-5.6",
  })).toEqual({
    id: "assistant-invalid-model",
    sessionId: "child",
    role: "assistant",
    createdAt: 10,
    hasError: false,
  });
  expect(projectMessage({
    id: "user-invalid-model",
    sessionID: "child",
    role: "user",
    time: { created: 11 },
    agent: "general",
    model: { providerID: "openai", modelID: "token=model-secret" },
  })).toEqual({
    id: "user-invalid-model",
    sessionId: "child",
    role: "user",
    createdAt: 11,
    agentName: "general",
  });
  expect(projectMessage({
    id: "assistant-valid-model",
    sessionID: "child",
    role: "assistant",
    time: { created: 12 },
    providerID: "openai",
    modelID: "gpt-5.6",
  })).toMatchObject({ providerId: "openai", modelId: "gpt-5.6" });
});

test("accepts text only from an Assistant message", () => {
  const textPart = {
    id: "text-1",
    sessionID: "child",
    messageID: "message-1",
    type: "text",
    text: "answer token=secret-value",
  };

  expect(projectPart(textPart, { messageRole: "user", observedAt: 10 })).toBeUndefined();
  expect(projectPart(textPart, { messageRole: "assistant", observedAt: 10 })).toMatchObject({
    kind: "assistant-text",
    text: "answer token=[redacted]",
  });
});

test("does not retain secrets disguised as allowlisted identifiers", () => {
  expect(safeCorrelationId("sk-1234567890abcdefgh")).toBeUndefined();
  expect(safeDisplayIdentifier("token=agent-secret")).toBeUndefined();
  expect(safeToolName("ghp_1234567890abcdefgh")).toBe("unknown");
});

test("ignores raw reasoning and accepts only an explicitly public top-level summary", () => {
  expect(
    projectPart(
      { type: "reasoning", id: "r1", sessionID: "child", messageID: "a1", text: "raw" },
      { messageRole: "assistant", observedAt: 10 },
    ),
  ).toBeUndefined();

  expect(
    projectPart(
      {
        type: "reasoning",
        id: "r2",
        sessionID: "child",
        messageID: "a1",
        text: "raw-secret",
        summaryVisibility: "public",
        publicSummary: "safe summary token=secret-value",
      },
      { messageRole: "assistant", observedAt: 11 },
    ),
  ).toMatchObject({ kind: "public-reasoning-summary", text: "safe summary token=[redacted]" });
});
```

The current SDK does not declare `summaryVisibility` or `publicSummary`. Guard this future-compatible shape from `unknown` without casting it to an SDK extension, and return `undefined` unless both top-level fields match exactly. Do not inspect `metadata` to discover a summary.

- [ ] **Step 3: Run the new tests and observe missing modules**

Run: `bun test tests/subagent-redaction.test.ts tests/subagent-normalizer.test.ts`

Expected: FAIL because the redaction, projection, and observer view modules do not exist.

- [ ] **Step 4: Implement redaction in the mandated order**

Use one function per ordered pass and always replace the credential value with `[redacted]`:

```ts
const REDACTED = "[redacted]";
const SENSITIVE_NAME = String.raw`(?:authorization|password|secret|token|api[_-]?key|apikey)`;

function redactNamedValues(text: string): string {
  return text.replace(
    new RegExp(`\\b(${SENSITIVE_NAME})(\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;]+)`, "giu"),
    (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`,
  );
}

function redactAuthorizationSchemes(text: string): string {
  return text.replace(/\b(Basic|Bearer|Digest|Token)\s+[^\s,;]+/giu, (_match, scheme: string) =>
    `${scheme} ${REDACTED}`,
  );
}

function redactRecognizedTokens(text: string): string {
  return text
    .replace(/\b(?:sk|pk|ghp|gho|ghu|ghs|ghr|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}\b/gu, REDACTED)
    .replace(/\bAKIA[A-Z0-9]{16}\b/gu, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, REDACTED);
}

function redactEnvironmentAssignments(text: string): string {
  return text.replace(
    /\b([A-Z][A-Z0-9_]*(?:AUTHORIZATION|PASSWORD|SECRET|TOKEN|API_KEY|APIKEY)[A-Z0-9_]*)(=)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gu,
    (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`,
  );
}

export function redactAndTruncate(text: string, maxLength: number): string {
  const redacted = redactEnvironmentAssignments(
    redactRecognizedTokens(redactAuthorizationSchemes(redactNamedValues(text))),
  );
  if (redacted.length <= maxLength) return redacted;
  if (maxLength <= 1) return "…".slice(0, maxLength);
  return `${redacted.slice(0, maxLength - 1)}…`;
}
```

Set `LATEST_TEXT_LIMIT` and `REASONING_SUMMARY_LIMIT` to 160, `DISPLAY_IDENTIFIER_LIMIT` and `TOOL_NAME_LIMIT` to 64, and `CORRELATION_ID_LIMIT` to 128. Every string admitted to a safe projection must pass through redaction before storage. `safeCorrelationId` and `safeDisplayIdentifier` return `undefined` when redaction changed the value or when the redacted candidate fails `/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/u` within its limit. `safeToolName` applies the same rule and returns `unknown` on failure. Invalid session/message/part IDs cause that projection/event to be dropped; invalid agent names fall back to `unknown`; invalid provider/model identifiers remain absent.

- [ ] **Step 5: Implement safe projections and documented fallback precedence**

Project Session values without title, slug, directory, summary, permissions, or `metadata`; Message values without `system`, tools, error detail, structured output, token data, cost, or paths; and Part values through a discriminated union. Convert Assistant `error` to the boolean `hasError` without reading or serializing its content. Keep agent candidates so the Registry can resolve AgentPart, then Subtask, then UserMessage. Keep model candidates so it can resolve newest Assistant provider/model, then UserMessage model.

```ts
export type SafePartProjection =
  | { readonly kind: "agent"; readonly sessionId: string; readonly messageId: string; readonly partId: string; readonly name: string; readonly observedAt: number }
  | { readonly kind: "subtask"; readonly sessionId: string; readonly messageId: string; readonly partId: string; readonly agent: string; readonly observedAt: number }
  | { readonly kind: "assistant-text"; readonly sessionId: string; readonly messageId: string; readonly partId: string; readonly text: string; readonly observedAt: number }
  | { readonly kind: "public-reasoning-summary"; readonly sessionId: string; readonly messageId: string; readonly partId: string; readonly text: string; readonly observedAt: number }
  | { readonly kind: "tool"; readonly sessionId: string; readonly messageId: string; readonly partId: string; readonly activity: ObserverToolActivity };
```

Use `part.id` as the tool identity and only fall back to `callID` when `id` is absent from an unknown/malformed payload. Map SDK status values exactly to `pending`, `running`, `completed`, and `error`. Map missing or unrecognized session status to `unknown`.

- [ ] **Step 6: Run projection tests and the first stack-layer gate**

Run: `bun test tests/subagent-redaction.test.ts tests/subagent-normalizer.test.ts tests/subagent-config.test.ts tests/subagent-validation.test.ts`

Run: `bun run typecheck`

Expected: both commands exit 0, and serialized projected fixtures contain none of the hostile secret strings.

- [ ] **Step 7: Commit safe projection when Git operations are authorized**

```bash
git add src/subagent-redaction.ts src/subagent-normalizer.ts src/subagent-types.ts tests/subagent-redaction.test.ts tests/subagent-normalizer.test.ts
git commit -m "feat: サブエージェント情報を安全に正規化する"
```

### Task 3: Normalize Complete EventBus and SSE Streams

**Stack layer:** `observer/events-snapshot`

**Files:**

- Modify: `src/subagent-event-source.ts`
- Modify: `tests/subagent-event-source.test.ts`

**Interfaces:**

- Consumes: typed `api.event.on` callbacks or `api.client.event.subscribe()` streams.
- Produces:

```ts
export type NormalizedObserverEvent =
  | { readonly type: "session.upsert"; readonly sequence: number; readonly observedAt: number; readonly session: SafeSessionProjection }
  | { readonly type: "session.deleted"; readonly sequence: number; readonly observedAt: number; readonly sessionId: string }
  | { readonly type: "message.upsert"; readonly sequence: number; readonly observedAt: number; readonly message: SafeMessageProjection }
  | { readonly type: "message.removed"; readonly sequence: number; readonly observedAt: number; readonly sessionId: string; readonly messageId: string }
  | { readonly type: "part.upsert"; readonly sequence: number; readonly observedAt: number; readonly part: SafePartProjection }
  | { readonly type: "part.refresh"; readonly sequence: number; readonly observedAt: number; readonly sessionId: string; readonly messageId: string; readonly partId: string }
  | { readonly type: "part.removed"; readonly sequence: number; readonly observedAt: number; readonly sessionId: string; readonly messageId: string; readonly partId: string }
  | { readonly type: "status.changed"; readonly sequence: number; readonly observedAt: number; readonly sessionId: string; readonly status: ObserverRuntimeStatus }
  | { readonly type: "session.idle"; readonly sequence: number; readonly observedAt: number; readonly sessionId: string }
  | { readonly type: "session.error"; readonly sequence: number; readonly observedAt: number; readonly sessionId: string }
  | { readonly type: "session.retry"; readonly sequence: number; readonly observedAt: number; readonly sessionId: string; readonly attempt: number };

export interface ObserverEventSource {
  start(): void;
  stop(): Promise<void>;
  onEvent(handler: (event: NormalizedObserverEvent) => void): () => void;
  onReconnectRequired(handler: () => Promise<void> | void): () => void;
}

export interface TuiEventBusSourceDependencies {
  readonly eventBus: TuiPluginApi["event"];
  readonly logger: SubagentLogger;
  readonly now?: () => number;
}

export interface SseEventSourceDependencies {
  readonly subscribe: (
    signal: AbortSignal,
  ) => Promise<{ readonly stream: AsyncIterable<unknown> }>;
  readonly logger: SubagentLogger;
  readonly sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
  readonly now?: () => number;
  readonly lifecycleSignal?: AbortSignal;
}

export class TuiEventBusSource implements ObserverEventSource {
  constructor(deps: TuiEventBusSourceDependencies);
}

export class SseEventSource implements ObserverEventSource {
  constructor(deps: SseEventSourceDependencies);
}
```

- [ ] **Step 1: Replace reduced-event tests with the complete event matrix**

Drive the EventBus source through these exact OpenCode names and expected normalized discriminants:

```ts
const cases = [
  ["session.created", "session.upsert"],
  ["session.updated", "session.upsert"],
  ["session.deleted", "session.deleted"],
  ["message.updated", "message.upsert"],
  ["message.removed", "message.removed"],
  ["message.part.updated", "part.upsert"],
  ["message.part.removed", "part.removed"],
  ["session.status", "status.changed"],
  ["session.idle", "session.idle"],
  ["session.error", "session.error"],
  ["session.next.retried", "session.retry"],
] as const;
```

Use a tool part for the `part.upsert` case. Use a text part without a known Assistant role for a second `message.part.updated` assertion and expect `part.refresh`, proving user text is not retained speculatively.

- [ ] **Step 2: Add SSE wrapper, ordering, reconnect, malformed, and stop cases**

```ts
test("unwraps SDK GlobalEvent payloads and preserves source order", async () => {
  const received: NormalizedObserverEvent[] = [];
  const source = new SseEventSource({
    subscribe: async () => ({
      stream: (async function* () {
        yield { directory: "/repo", payload: sessionCreatedEvent("child", "root", 10) };
        yield { directory: "/repo", payload: statusEvent("child", { type: "busy" }) };
        yield { directory: "/repo", payload: retryEvent("child", 2) };
      })(),
    }),
    logger: new RecordingLogger(),
    sleep: abortableSleepForTest,
    now: () => 50,
  });
  source.onEvent((event) => received.push(event));

  source.start();
  await settleAsyncEvents();
  await source.stop();

  expect(received.map((event) => [event.sequence, event.type])).toEqual([
    [1, "session.upsert"],
    [2, "status.changed"],
    [3, "session.retry"],
  ]);
});
```

The wrapper fixture above is the SDK `GlobalEvent` shape. Keep its `directory`
routing field in the test; do not simplify it to direct events. The same
normalizer must also accept project-scoped `api.client.event.subscribe()` items,
which arrive as direct event objects.

Assert that `stop()` aborts a pending subscription, reconnect handlers run before backoff after a stream error or unexpected completion, unknown events emit nothing, a `session.error` without `sessionID` logs only a static sanitized warning, and calling `start()` twice does not duplicate subscriptions.

- [ ] **Step 3: Run event-source tests and observe failures from the old reduced union**

Run: `bun test tests/subagent-event-source.test.ts`

Expected: FAIL because the current source subscribes to only four event names and includes Basic-auth/SSE connection behavior.

- [ ] **Step 4: Implement one unknown-input normalizer shared by both sources**

Register all eleven event names in `TuiEventBusSource`. Normalize `properties` payloads immediately and never log or stringify raw events. For SSE, accept either a direct event object or any record whose `payload` property is an event record, including the SDK `{ directory, project?, workspace?, payload }` `GlobalEvent` envelope. Treat wrapper metadata as routing-only data, do not require exact-key equality, and reject non-record payloads and unrelated wrapper shapes.

For `message.part.updated`:

```ts
if (!isRecord(properties.part)) return undefined;
const identifiers = readPartIdentifiers(properties.part);
if (identifiers === undefined) return undefined;
if (properties.part.type === "text" || properties.part.type === "reasoning") {
  return { type: "part.refresh", sequence, observedAt, ...identifiers };
}
const projected = projectPart(properties.part, {
  messageRole: undefined,
  observedAt,
});
return projected === undefined
  ? undefined
  : { type: "part.upsert", sequence, observedAt, part: projected };
```

Always refresh text/reasoning through `ObserverSnapshotReader.readMessage`, where the owning Message role is available; never speculate that text is Assistant output. Neither source keeps message-role, child-ID, message, or part maps, so source memory is independent of stream cardinality. Parent correlation belongs to the Registry.

Remove `buildSseHeaders`, username/password fields, `listSessions`, and all legacy connection code. `SseEventSource` receives only `subscribe`, `logger`, `sleep`, `now`, and an optional lifecycle signal.

- [ ] **Step 5: Run event-source and safety tests**

Run: `bun test tests/subagent-event-source.test.ts tests/subagent-normalizer.test.ts tests/subagent-redaction.test.ts`

Expected: PASS; both source implementations emit the same normalized values for equivalent input events.

- [ ] **Step 6: Commit event normalization when Git operations are authorized**

```bash
git add src/subagent-event-source.ts tests/subagent-event-source.test.ts
git commit -m "feat: Observer向けイベントを完全に正規化する"
```

### Task 4: Hydrate Bounded Direct-Child Snapshots

**Stack layer:** `observer/events-snapshot`

**Files:**

- Create: `src/subagent-snapshot-reader.ts`
- Create: `tests/subagent-snapshot-reader.test.ts`

**Interfaces:**

- Consumes: `api.client.session.children`, `api.client.session.status`, `api.client.session.messages`, and optionally synchronous `api.state.session`/`api.state.part` reads for event refreshes.
- Produces only safe projections:

```ts
export interface HydratedSubagent {
  readonly session: SafeSessionProjection;
  readonly status: ObserverRuntimeStatus;
  readonly messages: readonly SafeMessageProjection[];
  readonly parts: readonly SafePartProjection[];
}

export interface ObserverParentSnapshot {
  readonly parentSessionId: string;
  readonly children: readonly HydratedSubagent[];
  readonly omittedCount: number;
  readonly ignoredSessionIdsSeen: readonly string[];
}

export interface ObserverSnapshotReader {
  readParent(
    parentSessionId: string,
    config: ObserverConfig,
    signal: AbortSignal,
    ignoredSessionIds?: ReadonlySet<string>,
  ): Promise<ObserverParentSnapshot>;
  readMessage(
    sessionId: string,
    messageId: string,
    signal: AbortSignal,
  ): Promise<{ readonly message?: SafeMessageProjection; readonly parts: readonly SafePartProjection[] }>;
}

export interface OpenCodeSnapshotReaderDependencies {
  readonly sessionClient: Pick<
    TuiPluginApi["client"]["session"],
    "children" | "status" | "messages" | "message"
  >;
  readonly sessionState: Pick<
    TuiPluginApi["state"]["session"],
    "get" | "messages" | "status"
  >;
  readonly readParts: TuiPluginApi["state"]["part"];
  readonly logger: SubagentLogger;
}

export function createOpenCodeSnapshotReader(
  deps: OpenCodeSnapshotReaderDependencies,
): ObserverSnapshotReader;
```

- [ ] **Step 1: Write a snapshot fixture with roots, children, and a grandchild**

```ts
test("hydrates only direct children and bounds detailed reads", async () => {
  const calls: string[] = [];
  const reader = createOpenCodeSnapshotReader(
    fakeSnapshotDependencies({
      children: [
        session("child-new", "root", 30),
        session("child-old", "root", 10),
        session("grandchild", "child-old", 40),
      ],
      statuses: { "child-new": { type: "busy" }, "child-old": { type: "idle" } },
      messages: {
        "child-new": [assistantBundle("child-new", "assistant-new", 31, "new answer")],
        "child-old": [userBundle("child-old", "user-old", 11, "private prompt")],
      },
      calls,
    }),
  );

  const result = await reader.readParent(
    "root",
    { ...DEFAULT_OBSERVER_CONFIG, maxTrackedSubagents: 8 },
    new AbortController().signal,
  );

  expect(result.children.map((child) => child.session.id)).toEqual(["child-new", "child-old"]);
  expect(result.ignoredSessionIdsSeen).toEqual([]);
  expect(calls).not.toContain("messages:grandchild");
  expect(JSON.stringify(result)).not.toContain("private prompt");
});
```

- [ ] **Step 2: Add status urgency, overflow, missing data, abort, and message refresh cases**

Use nine direct children with `maxTrackedSubagents: 8`; make the oldest child `retry` and verify it remains while the least urgent/oldest idle child contributes to `omittedCount: 1`. Assert `readMessage` returns no text for a User message, returns redacted text for an Assistant message, returns an empty safe bundle on a missing message, and propagates `AbortError` without logging it as a failure. Initial `error` state is derived only when hydrated Assistant data contains an error; the SDK session-status snapshot itself exposes only `busy`, `idle`, and `retry`.

- [ ] **Step 3: Run the new tests and observe the missing reader**

Run: `bun test tests/subagent-snapshot-reader.test.ts`

Expected: FAIL because `createOpenCodeSnapshotReader` does not exist.

- [ ] **Step 4: Implement hydration through existing OpenCode APIs**

Call APIs with the signal in the SDK options argument, not inside legacy parameter shapes:

```ts
const [childrenResult, statusResult] = await Promise.all([
  sessionClient.children({ sessionID: parentSessionId }, { signal }),
  sessionClient.status({}, { signal }),
]);
const messagesResult = await sessionClient.messages(
  { sessionID: child.id, limit: MESSAGE_REFERENCE_LIMIT },
  { signal },
);
```

Set `MESSAGE_REFERENCE_LIMIT` to 32, `PART_REFERENCE_LIMIT` to 64, and `HYDRATION_CONCURRENCY` to 8. Verify `child.parentID === parentSessionId` even though the children endpoint should already enforce it. Filter IDs in `ignoredSessionIds` before ranking and return the bounded intersection as `ignoredSessionIdsSeen`. Rank pre-hydration candidates by the statuses available from the SDK snapshot (`retry`, `busy`, `idle`, `unknown`), then descending `session.time.updated`; hydrate only the first `maxTrackedSubagents` through an eight-worker promise pool and report the remaining non-ignored count. After hydration, an Assistant `hasError` projection may promote a tracked child to `error` for Registry/UI ordering.

Sort message bundles by `info.time.created`, project each `{ info, parts }` bundle immediately, and pass `info.role` into `projectPart`. Retain at most 32 newest message projections and 64 safe part projections per child. When truncating parts, preserve the newest agent, subtask, Assistant text, public summary, running tool, and pending tool before filling the remaining slots by recency; later reduce completed/error tools to `activityLimit`. Never return SDK objects.

For `readMessage`, find `messageID` in `sessionState.messages(sessionId)`. If present, project that message with `readParts(messageID)` immediately; if absent, call `sessionClient.message({ sessionID, messageID }, { signal })`. Treat an undefined response as an empty safe bundle.

- [ ] **Step 5: Run the second stack-layer gate**

Run: `bun test tests/subagent-event-source.test.ts tests/subagent-snapshot-reader.test.ts tests/subagent-normalizer.test.ts tests/subagent-redaction.test.ts`

Run: `bun run typecheck`

Expected: both commands exit 0.

- [ ] **Step 6: Commit snapshot hydration when Git operations are authorized**

```bash
git add src/subagent-snapshot-reader.ts tests/subagent-snapshot-reader.test.ts
git commit -m "feat: 子セッションの初期状態を安全に取得する"
```

### Task 5: Implement the Bounded Parent-Scoped SubagentRegistry

**Stack layer:** `observer/registry`

**Files:**

- Create: `src/subagent-registry.ts`
- Create: `tests/subagent-registry.test.ts`

**Interfaces:**

- Consumes: `ObserverEventSource`, `ObserverSnapshotReader`, and `ObserverConfig`.
- Produces:

```ts
export interface SubagentRegistryDependencies {
  readonly eventSource: ObserverEventSource;
  readonly snapshotReader: ObserverSnapshotReader;
  readonly config: ObserverConfig;
  readonly logger: SubagentLogger;
  readonly now?: () => number;
  readonly queueMicrotask?: (callback: () => void) => void;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class SubagentRegistry {
  constructor(deps: SubagentRegistryDependencies);
  selectParent(parentSessionId: string): Promise<void>;
  snapshot(): ObserverRegistrySnapshot;
  subscribe(listener: () => void): () => void;
  resyncNow(): Promise<void>;
  stop(): Promise<void>;
  debugCounts(): {
    readonly trackedChildren: number;
    readonly pendingChildren: number;
    readonly messageReferences: number;
    readonly partReferences: number;
    readonly inFlightRefreshes: number;
  };
}
```

- [ ] **Step 1: Write initial-hydration and resync snapshot race tests**

```ts
test("subscribes before hydration and replays buffered events in source order", async () => {
  const source = new MemoryObserverEventSource();
  const hydration = createDeferred<ObserverParentSnapshot>();
  const registry = registryFor({ source, readParent: () => hydration.promise });

  const selecting = registry.selectParent("root");
  expect(source.started).toBe(true);
  source.emit(sessionUpsert("child", "root", 1));
  source.emit(statusChanged("child", "busy", 2));
  hydration.resolve({
    parentSessionId: "root",
    children: [hydratedChild("child", "root", "idle", 1)],
    omittedCount: 0,
    ignoredSessionIdsSeen: [],
  });
  await selecting;

  expect(registry.snapshot()).toMatchObject({
    parentSessionId: "root",
    ready: true,
    views: [{ sessionId: "child", status: "busy" }],
  });
});

test("replays status changes and message removals that arrive during resync", async () => {
  const source = new MemoryObserverEventSource();
  const resyncRead = createDeferred<ObserverParentSnapshot>();
  let readCount = 0;
  const childWithMessage = {
    session: {
      id: "child-message",
      parentSessionId: "root",
      createdAt: 2,
      updatedAt: 2,
    },
    status: "busy",
    messages: [{
      id: "assistant-1",
      sessionId: "child-message",
      role: "assistant",
      createdAt: 2,
      providerId: "openai",
      modelId: "gpt-5.6",
      hasError: false,
    }],
    parts: [],
  } satisfies HydratedSubagent;
  const initial = {
    parentSessionId: "root",
    children: [
      hydratedChild("child-update", "root", "idle", 1),
      childWithMessage,
    ],
    omittedCount: 0,
    ignoredSessionIdsSeen: [],
  } satisfies ObserverParentSnapshot;
  const registry = registryFor({
    source,
    readParent: () => {
      readCount += 1;
      return readCount === 1 ? Promise.resolve(initial) : resyncRead.promise;
    },
  });

  await registry.selectParent("root");
  const resyncing = registry.resyncNow();
  await Promise.resolve();
  expect(readCount).toBe(2);
  source.emit(statusChanged("child-update", "busy", 10));
  source.emit(messageRemoved("child-message", "assistant-1", 11));
  resyncRead.resolve({
    parentSessionId: "root",
    children: [
      hydratedChild("child-update", "root", "idle", 1),
      childWithMessage,
    ],
    omittedCount: 0,
    ignoredSessionIdsSeen: [],
  });
  await resyncing;

  expect(registry.snapshot().views.find((view) => view.sessionId === "child-update"))
    .toMatchObject({ status: "busy" });
  const childAfterRemoval = registry.snapshot().views.find(
    (view) => view.sessionId === "child-message",
  );
  expect(childAfterRemoval).toBeDefined();
  expect(childAfterRemoval).not.toHaveProperty("providerId");
  expect(childAfterRemoval).not.toHaveProperty("modelId");
});
```

- [ ] **Step 2: Add parent, agent/model, status, and tool transition tests**

Cover these exact outcomes:

```ts
expect(agentName(viewWithAgentPart)).toBe("explore");
expect(agentName(viewWithSubtaskOnly)).toBe("librarian");
expect(agentName(viewWithUserMessageOnly)).toBe("general");
expect(model(viewWithAssistantAndUser)).toEqual({ providerId: "openai", modelId: "gpt-5.6" });
expect(statusesAfterRetryBusyIdleError).toEqual(["retry", "busy", "idle", "error"]);
expect(activityIdsAfterPendingRunningCompleted).toEqual(["tool-part-1"]);
```

Emit a newer Assistant Message using another provider/model and assert the existing view changes without duplication. Exercise both pending → running → completed and pending → running → error for one tool identity. During initial hydration, derive `error` only when the newest projected Assistant Message has `hasError: true`; after initialization, apply status/message error state by event sequence, and clear it only when a later status, idle, retry, or deletion event supersedes it. Switch from parent `root-a` to `root-b` and assert `root-a` children disappear before `root-b` becomes ready. Emit a grandchild Session upsert whose `parentId` is a tracked child and assert it never appears.

- [ ] **Step 3: Add capacity, overflow, retention, restoration, and bound tests**

Use fake time and timers. Fill eight active entries, emit a ninth, and assert the eight active entries remain plus `overflowCount: 1`. Mark one idle, advance beyond `idleRetentionMs`, run its timer, and verify the idle entry is evicted before a resync restores the highest-urgency omitted child.

Lock the initial snapshot count separately from event-driven overflow:

```ts
test("reports children omitted by the initial bounded snapshot", async () => {
  const allChildren = Array.from({ length: 9 }, (_, index) =>
    hydratedChild(`child-${index + 1}`, "root", "idle", index + 1),
  );
  const registry = registryFor({
    config: { ...DEFAULT_OBSERVER_CONFIG, maxTrackedSubagents: 8 },
    readParent: (_parentSessionId, config) => Promise.resolve({
      parentSessionId: "root",
      children: allChildren.slice(0, config.maxTrackedSubagents),
      omittedCount: Math.max(0, allChildren.length - config.maxTrackedSubagents),
      ignoredSessionIdsSeen: [],
    }),
  });

  await registry.selectParent("root");

  expect(registry.snapshot().views).toHaveLength(8);
  expect(registry.snapshot().overflowCount).toBe(1);
});
```

Add a stale-resync deletion case for a known capacity-omitted child. Fill all
eight tracked slots, emit an upsert for `child-9` so it enters the bounded
omitted-ID set, then emit its deletion. Record the `ignoredSessionIds` argument
received by `readParent`, return a stale fixture that still contains `child-9`,
and assert the ignored set contains `child-9` and the ready Registry snapshot
does not. Also assert the tombstone is removed only after a later successful
snapshot no longer reports that ID in `ignoredSessionIdsSeen`.

Burst 10,000 malformed and unknown-child events. Assert:

```ts
expect(registry.debugCounts().trackedChildren).toBeLessThanOrEqual(config.maxTrackedSubagents);
expect(registry.debugCounts().pendingChildren).toBeLessThanOrEqual(config.maxTrackedSubagents);
expect(registry.debugCounts().messageReferences).toBeLessThanOrEqual(
  config.maxTrackedSubagents * MESSAGE_REFERENCE_LIMIT,
);
expect(registry.debugCounts().partReferences).toBeLessThanOrEqual(
  config.maxTrackedSubagents * PART_REFERENCE_LIMIT,
);
expect(registry.debugCounts().inFlightRefreshes).toBeLessThanOrEqual(
  config.maxTrackedSubagents,
);
```

Assert overflow saturates at `Number.MAX_SAFE_INTEGER` rather than wrapping or allocating omitted IDs.

Emit 100 status transitions synchronously, await one microtask, and assert subscribers were called once with the final status. This locks the no-debounce, sub-250-ms update path without a wall-clock-flaky assertion.

- [ ] **Step 4: Run Registry tests and observe the missing state machine**

Run: `bun test tests/subagent-registry.test.ts`

Expected: FAIL because `SubagentRegistry` does not exist.

- [ ] **Step 5: Implement initialization, stale-run cancellation, and safe pending correlation**

Subscribe and start the event source before calling `readParent`. Increment a `selectionGeneration` for every `selectParent`; discard a completed hydration if its generation is stale. Buffer normalized events by `sessionId` while hydration is in progress, cap pending child buckets at `maxTrackedSubagents`, and cap each bucket at `MESSAGE_REFERENCE_LIMIT + PART_REFERENCE_LIMIT + 8` events by coalescing the newest event for the same message, part, status, or tool identity.

Use one saturating addition helper for snapshot and event overflow accounting:

```ts
function saturatingAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}
```

On successful hydration, replace the active parent's tracked map, initialize
`overflowCount` from `snapshot.omittedCount` with `saturatingAdd(0,
snapshot.omittedCount)`, apply buffered events in ascending `sequence`, set
`ready: true`, then notify subscribers. A later successful resync replaces the
previous snapshot-derived overflow base instead of cumulatively adding the same
omissions again; only replayed post-watermark events add to that base. On
hydration failure other than abort, log a sanitized warning, expose an empty
ready snapshot, and keep the event source alive.

For `part.refresh`, maintain at most one in-flight `readMessage` call per tracked child. If another refresh arrives for that child, retain only the newest `{ messageId, sequence }` and run it after the current read settles. Tag every read with `selectionGeneration`; apply it only when the generation and parent still match and the child remains tracked. Replace that message's previous safe message/part projections atomically, reapply reference limits, and never log an `AbortError` or raw client error payload. Abort all refresh controllers on parent change and stop. Test a deferred refresh followed by parent change and prove its late result cannot update the new parent.

- [ ] **Step 6: Implement deterministic state derivation and ordering**

Maintain only safe projections. Recompute each public view with these exact rules:

```ts
const STATUS_URGENCY: Record<ObserverRuntimeStatus, number> = {
  error: 0,
  retry: 1,
  busy: 2,
  idle: 3,
  unknown: 4,
};

const orderedViews = [...entries.values()]
  .map(toRuntimeView)
  .sort((left, right) =>
    STATUS_URGENCY[left.status] - STATUS_URGENCY[right.status]
    || right.updatedAt - left.updatedAt
    || left.sessionId.localeCompare(right.sessionId),
  );
```

Resolve current tool activity by newest `running`, then newest `pending`. Keep completed/error tools only in `recentActivity`, bounded by `activityLimit`. Update one activity in place for pending → running → completed/error transitions; never append a duplicate identity.

Use `unknown` as the agent name when none of AgentPart, Subtask, or UserMessage provides a valid name. Leave provider/model undefined when neither AssistantMessage nor UserMessage provides a valid pair.

- [ ] **Step 7: Implement retention, active-entry backpressure, and resync restoration**

Delete immediately on `session.deleted`. On idle, set `retentionDeadline = observedAt + idleRetentionMs`; if the duration is zero, remove immediately. Cancel that deadline when a later busy, retry, or error event arrives. Before admitting a new child at capacity, evict the least-recent idle child whose deadline has elapsed. If no entry is eligible, keep every retained child, omit the new detail, and increment the aggregate overflow counter. Repeated events for an already-known omitted ID must not increment the counter again; keep only a capped omitted-ID deduplication set of `maxTrackedSubagents`, then use saturating aggregate increments for additional unseen overflow.

Call `resyncNow()` after deletion, retention expiry, and source reconnect. `selectParent()` itself performs the new parent's initial snapshot read. Before every `readParent` call, capture the highest event `sequence` already applied as a watermark and enter the same bounded/coalescing buffering mode used by initial hydration. Events newer than the watermark must not mutate the tracked map while the snapshot is in flight. After a successful read, replace the tracked map and snapshot-derived overflow base, then replay buffered events in ascending `sequence` before notifying subscribers. If a resync read fails without aborting or changing parent generation, retain the existing map and replay the buffered events onto it so the failed read cannot lose live updates. Serialize this whole read-replace-replay operation through one in-flight promise and rerun once when another request arrives while it is active.

Keep a bounded deleted-session tombstone set, capped at `maxTrackedSubagents`, and add IDs that were tracked, pending direct children, or present in the bounded capacity-omitted ID set. Add the tombstone before requesting resync. For a known omitted deletion, remove the ID from omitted deduplication and decrement a non-saturated overflow count with a floor of zero; if the aggregate is already saturated, leave it saturated until the next successful snapshot establishes an authoritative base. Pass tombstones to `readParent` as `ignoredSessionIds` so a stale server snapshot cannot consume capacity or resurrect a just-deleted card. Retain IDs returned in `ignoredSessionIdsSeen`, remove absent IDs after a successful resync, and clear all tombstones and omitted-ID state on parent change or stop.

- [ ] **Step 8: Coalesce subscriber notifications and implement complete disposal**

Schedule at most one subscriber callback per microtask. `stop()` must abort active hydration, clear every retention timer, unsubscribe handlers, await `eventSource.stop()`, clear tracked/pending maps, and become idempotent.

- [ ] **Step 9: Run Registry, event, snapshot, and type gates**

Run: `bun test tests/subagent-registry.test.ts tests/subagent-event-source.test.ts tests/subagent-snapshot-reader.test.ts`

Run: `bun run typecheck`

Expected: both commands exit 0; the 10,000-event bound fixture completes without increasing the declared maxima.

- [ ] **Step 10: Commit the Registry layer when Git operations are authorized**

```bash
git add src/subagent-registry.ts tests/subagent-registry.test.ts
git commit -m "feat: Observerの状態を上限付きで管理する"
```

### Task 6: Render Theme-Aware Scrollable Observer Cards

**Stack layer:** `observer/sidebar`

**Files:**

- Create: `src/subagent-observer.tsx`
- Create: `tests/subagent-observer.test.tsx`

**Interfaces:**

- Consumes: `SubagentRegistry`, `ObserverConfig`, `sessionId`, and `TuiThemeCurrent`.
- Produces:

```ts
export interface SidebarObserverProps {
  readonly registry: SubagentRegistry;
  readonly config: ObserverConfig;
  readonly sessionId: string;
  readonly theme: TuiThemeCurrent;
}

export function SidebarObserver(props: SidebarObserverProps): JSX.Element;
export function SubagentCard(props: {
  readonly view: SubagentRuntimeView;
  readonly config: ObserverConfig;
  readonly theme: TuiThemeCurrent;
}): JSX.Element;
```

- [ ] **Step 1: Write a real OpenTUI render fixture for one card**

```tsx
test("renders status and activity as primary fields with conditional secondary text", async () => {
  const registry = new FakeRegistry({
    parentSessionId: "root",
    ready: true,
    overflowCount: 0,
    views: [runtimeView({
      agentName: "explore",
      providerId: "openai",
      modelId: "gpt-5.6",
      status: "busy",
      currentActivity: { id: "tool-1", toolName: "read", state: "running", updatedAt: 20 },
      latestAssistantText: "Found the lifecycle implementation.",
      publicReasoningSummary: "Correlating the latest event.",
    })],
  });
  const setup = await testRender(
    () => <SidebarObserver registry={registry} config={DEFAULT_ENABLED_CONFIG} sessionId="root" theme={theme} />,
    { width: 42, height: 14 },
  );

  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  setup.renderer.destroy();

  expect(frame).toContain("explore");
  expect(frame).toContain("BUSY");
  expect(frame).toContain("openai · gpt-5.6");
  expect(frame).toContain("read");
  expect(frame).toContain("Found the lifecycle implementation.");
  expect(frame).toContain("Reasoning: Correlating the latest event.");
});
```

- [ ] **Step 2: Add visibility, ordering, parent-change, overflow, and scroll tests**

Render one, four, and eight cards. For eight cards use a height that requires scrolling and assert the `scrollbox` contains all eight child components while the captured frame remains bounded. Toggle each display flag independently and assert the corresponding provider, model, Assistant text, or reasoning line disappears without removing status/activity.

Emit an updated fake Registry snapshot ordered as error, retry, busy, idle, unknown and assert the frame order. Change `sessionId` from `root-a` to `root-b`, run effects, and assert `registry.selectParent` receives both values while only the second parent's cards remain. With `maxVisibleSubagents: 8`, render nine tracked views plus `overflowCount: 3` and assert a single `+4 omitted` line, not four identifiers.

- [ ] **Step 3: Run the component test and observe the missing components**

Run: `bun test --conditions=browser --preload @opentui/solid/preload tests/subagent-observer.test.tsx`

Expected: FAIL because `SidebarObserver` and `SubagentCard` do not exist.

- [ ] **Step 4: Implement Registry-to-Solid subscription**

```tsx
export function SidebarObserver(props: SidebarObserverProps): JSX.Element {
  const [snapshot, setSnapshot] = createSignal(props.registry.snapshot());
  const unsubscribe = props.registry.subscribe(() => setSnapshot(props.registry.snapshot()));
  onCleanup(unsubscribe);

  createEffect(() => {
    void props.registry.selectParent(props.sessionId);
  });

  const visible = () => snapshot().views.slice(0, props.config.maxVisibleSubagents);
  const omitted = () => Math.min(
    Number.MAX_SAFE_INTEGER,
    snapshot().overflowCount
      + Math.max(0, snapshot().views.length - props.config.maxVisibleSubagents),
  );
  return (
    <scrollbox style={{ height: "100%", flexDirection: "column" }}>
      <Show when={snapshot().ready}>
        <For each={visible()}>
          {(view) => <SubagentCard view={view} config={props.config} theme={props.theme} />}
        </For>
        <Show when={omitted() > 0}>
          <text fg={props.theme.textMuted}>+{omitted()} omitted</text>
        </Show>
      </Show>
    </scrollbox>
  );
}
```

- [ ] **Step 5: Implement cards using only theme tokens**

Use `theme.error`, `theme.warning`, `theme.info`, `theme.success`, and `theme.textMuted`; do not introduce hex/RGB constants. Render uppercase runtime status and tool state. When both provider and model are enabled, join them with a middle dot (`·`); when only one is enabled, render only that value. Use `Show` for optional model/provider, Assistant text, and public reasoning summary. The status/current activity lines appear before all secondary text.

- [ ] **Step 6: Run browser component tests and typecheck**

Run: `bun test --conditions=browser --preload @opentui/solid/preload tests/subagent-observer.test.tsx`

Run: `bun run typecheck`

Expected: both commands exit 0 and the captured card frame contains no raw payload fields.

- [ ] **Step 7: Commit the sidebar UI when Git operations are authorized**

```bash
git add src/subagent-observer.tsx tests/subagent-observer.test.tsx
git commit -m "feat: サイドバーにObserverカードを表示する"
```

### Task 7: Register Only sidebar_content and Remove PTY Construction

**Stack layer:** `observer/sidebar`

**Files:**

- Modify: `src/subagent-integration.ts`
- Modify: `src/tui.tsx`
- Modify: `tests/subagent-integration.test.ts`
- Modify: `tests/tui.test.ts`

**Interfaces:**

- Consumes: fully resolved `ObserverConfig` and these OpenCode capabilities only: `client.session`, `client.event.subscribe`, `event.on`, `state.session`, `state.part`, `slots.register`, `theme`, and `lifecycle`.
- Produces:

```ts
export interface ObserverIntegrationHandle {
  readonly enabled: boolean;
  readonly registry?: SubagentRegistry;
  stop(): Promise<void>;
  resyncNow(): Promise<void>;
}

export async function attachSubagentIntegration(
  api: Pick<TuiPluginApi, "client" | "event" | "state" | "slots" | "theme" | "lifecycle">,
  config: ObserverConfig,
  deps?: {
    readonly logger?: SubagentLogger;
    readonly eventSource?: ObserverEventSource;
    readonly snapshotReader?: ObserverSnapshotReader;
  },
): Promise<ObserverIntegrationHandle>;

export function createTuiPlugin(deps?: {
  readonly logger?: SubagentLogger;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly attach?: typeof attachSubagentIntegration;
}): TuiPlugin;
```

- [ ] **Step 1: Replace TUI registration expectations with negative regression assertions**

```ts
test("registers only sidebar_content for an enabled observer", async () => {
  const registrations: unknown[] = [];
  const routeCalls: unknown[] = [];
  const keymapCalls: unknown[] = [];
  const api = makeTuiApi({ registrations, routeCalls, keymapCalls });

  await Reflect.apply(createTuiPlugin({
    env: { SIBYL_OBSERVER_ENABLED: "true" },
    attach: async (runtime, config) => {
      runtime.slots.register({ slots: { sidebar_content: () => null } });
      expect(config.enabled).toBe(true);
      return disabledHandle();
    },
  }), undefined, [api, undefined, tuiPluginMeta("first")]);

  expect(registrations).toHaveLength(1);
  expect(Object.keys((registrations[0] as { slots: object }).slots)).toEqual(["sidebar_content"]);
  expect(routeCalls).toEqual([]);
  expect(keymapCalls).toEqual([]);
});
```

Mock `./pty-manager.js`, `./opentui-pane-backend.js`, and `./layout-manager.js` with constructors/functions that throw. Import and invoke `createTuiPlugin`; assert it completes, proving the modules are neither statically imported nor constructed by the TUI entry.

- [ ] **Step 2: Write integration tests for disabled mode, slot props, warning once, resync, and cleanup**

Call `attachSubagentIntegration` with an enabled config and injected Memory source/reader. Capture the registered plugin and invoke:

```ts
const renderSidebar = registration.slots.sidebar_content;
const element = renderSidebar({ theme: api.theme }, { session_id: "parent-1" });
expect(element).toBeDefined();
```

Invoke the lifecycle disposer twice and assert `registry.stop()` is effectively called once. Trigger source reconnect and assert `resyncNow()` is requested. Pass default disabled config and assert no slot or source starts. Invoke the TUI twice with legacy settings and assert each invocation emits exactly one warning regardless of the number of legacy keys.

- [ ] **Step 3: Run focused integration tests and observe the old PTY dependencies**

Run: `bun test tests/subagent-integration.test.ts tests/tui.test.ts`

Expected: FAIL because current signatures require layout, PTY manager, pane backend, connection settings, route, and keymap.

- [ ] **Step 4: Rewrite attachSubagentIntegration as observer-only wiring**

Return the disabled handle before constructing sources when `config.enabled` is false. Otherwise use an injected source when present and create `TuiEventBusSource` from `api.event` by default. Keep `SseEventSource` as the client-stream implementation exposed for runtimes that inject it; it uses the host client's existing transport and never receives connection or credential settings. Construct the snapshot reader and Registry, then register the slot:

```tsx
api.slots.register({
  slots: {
    sidebar_content: (context, props) => (
      <SidebarObserver
        registry={registry}
        config={config}
        sessionId={props.session_id}
        theme={context.theme.current}
      />
    ),
  },
});
```

Register one async lifecycle cleanup that awaits `registry.stop()`. Do not resolve configuration, inspect legacy settings, register commands, or construct connection details inside this module.

- [ ] **Step 5: Rewrite createTuiPlugin as startup resolution plus attachment**

Remove all imports and parameters for `LayoutManager`, `createLayoutManagerController`, `OpenTuiPaneBackend`, `PaneBackend`, `PtyManager`, shell defaults, and `PtyOptions`. Use `deps.env ?? process.env` as the environment source, pass the TUI plugin's second `options` argument unchanged as `pluginOptions`, read `api.state.config` as `hostConfig`, and call `resolveObserverConfig`. Do not treat an `options.env` property as environment input. Issue this warning exactly once in each TUI plugin invocation when `legacySettingsDetected` is true:

```ts
logger.warn(
  "[subagent] legacy PTY display, connection, and attach settings are deprecated and ignored by Sibyl v2 Observer",
);
```

Call `attachSubagentIntegration(api, resolution.config, { logger })`, and re-export `attachSubagentIntegration` as a named API from `src/tui.tsx`. Do not register a route, call `route.navigate`, register a keymap layer, create an initial pane, or register `ptyManager.terminateAll()`.

- [ ] **Step 6: Add a built-bundle exclusion assertion**

After `bun run build`, read `dist/tui.js` and assert it contains `sidebar_content` but not these behavior markers:

```ts
expect(bundle).toContain("sidebar_content");
expect(bundle).not.toMatch(/sibyl\.open|sibyl\.split|opencode attach|Bun\.Terminal|node-pty/);
```

- [ ] **Step 7: Run the sidebar integration gate**

Run: `bun test tests/subagent-integration.test.ts tests/tui.test.ts`

Run: `bun run build`

Run: `bun test --conditions=browser --preload @opentui/solid/preload tests/subagent-observer.test.tsx`

Expected: all commands exit 0; no PTY fake is invoked.

- [ ] **Step 8: Commit the observer-only TUI path when Git operations are authorized**

```bash
git add src/subagent-integration.ts src/tui.tsx tests/subagent-integration.test.ts tests/tui.test.ts
git commit -m "feat: Observerをsidebar_contentへ統合する"
```

### Task 8: Remove Legacy Subagent PTY Paths and Migrate Public Surfaces

**Stack layer:** `observer/migration`

**Files:**

- Delete: `src/server.ts`
- Delete: `src/subagent-attach-args.ts`
- Delete: `src/subagent-pane-adapter.ts`
- Delete: `src/subagent-lifecycle-manager.ts`
- Delete: `tests/server.test.ts`
- Delete: `tests/subagent-attach-args.test.ts`
- Delete: `tests/subagent-layout-and-pane-adapter.test.ts`
- Delete: `tests/subagent-lifecycle-manager.test.ts`
- Modify: `src/index.ts`
- Modify: `rollup.config.js`
- Modify: `package.json`
- Modify: `tests/index.test.ts`
- Modify: `README.md`
- Modify: `SPEC.md`
- Modify: `docs/architecture.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: completed Observer modules from the lower stack layers.
- Produces: a TUI-only Observer plugin export plus server-safe normalized core exports.

- [ ] **Step 1: Change the public-export test before deleting legacy files**

After the build, require these observer runtime exports:

```ts
expect(Object.keys(exports)).toEqual(
  expect.arrayContaining([
    "DEFAULT_OBSERVER_CONFIG",
    "SubagentRegistry",
    "TuiEventBusSource",
    "SseEventSource",
    "createOpenCodeSnapshotReader",
    "normalizeRuntimeStatus",
    "redactAndTruncate",
    "resolveObserverConfig",
    "safeToolName",
  ]),
);

const tuiExports = await import("../dist/tui.js");
expect(Object.keys(tuiExports)).toEqual(
  expect.arrayContaining(["attachSubagentIntegration", "createTuiPlugin", "default", "id"]),
);
```

Assert each removed root export is absent:

```ts
for (const removed of [
  "SubagentLifecycleManager",
  "SubagentPaneAdapter",
  "attachSubagentIntegration",
  "buildAttachPtyOptions",
  "buildSseHeaders",
  "createDefaultAttachTarget",
  "createOpenTuiSubagentPaneManager",
  "getLastLifecycleOpenTarget",
  "resolveConnection",
]) {
  expect(Object.keys(exports)).not.toContain(removed);
}
```

- [ ] **Step 2: Run the export test and observe legacy names**

Run: `bun run build && bun test tests/index.test.ts`

Expected: FAIL because the legacy exports and server bundle still exist.

- [ ] **Step 3: Remove only the obsolete subagent PTY integration files**

Delete the four legacy source modules and four matching test files listed above. Remove their exports from `src/index.ts`. Export config, types, redaction, normalizer, event source, snapshot reader, and Registry modules from the server-safe root. Export `attachSubagentIntegration` and `createTuiPlugin` from `src/tui.tsx`; do not export the integration or `src/subagent-observer.tsx` from the root because they import Solid/OpenTUI UI code.

Keep generic PTY modules such as `PtyManager`, `PaneBackend`, and `OpenTuiPaneBackend` unchanged; they are outside the observer integration and may be removed only by a separate public-API deprecation plan.

In `tests/index.test.ts`, replace the two built-TUI PTY render scenarios with a built Observer slot render scenario. Load `dist/tui.js` under `@opentui/solid/preload`, capture the `sidebar_content` callback, render one hydrated child through `testRender`, and assert the frame contains its agent and status while no PTY fake or route is needed.

- [ ] **Step 4: Remove the obsolete server plugin package surface**

Delete `src/server.ts` and `tests/server.test.ts`. Remove the `./server` object from `package.json.exports` and the `src/server.ts` input from `rollup.config.js`. Change the package description to:

```json
"description": "Read-only OpenCode sidebar observer for direct child-agent sessions"
```

Do not add another server command or a compatibility route.

- [ ] **Step 5: Rewrite user-facing documentation around the Observer**

Update `README.md` with these sections and facts:

1. `Sibyl v2 Observer` overview: read-only direct-child monitoring in the active session sidebar.
2. Installation using only `@yohi/sibyl/tui` in `tui.json`.
3. Full `sibyl.observer` example containing all nine fields and their defaults/ranges.
4. The nine exact `SIBYL_OBSERVER_*` environment names and precedence.
5. Displayed allowlist, deterministic redaction, and excluded raw fields.
6. No route, keymap, PTY, shell, attach, prompt, permission, model/agent mutation, or Akane behavior.
7. Bun development commands.

Replace `SPEC.md` with the current Observer architecture, data flow, configuration, security, cleanup ownership, acceptance criteria, and deferred Akane phase from the approved design. Include a short `v1 historical context` section linking to the changelog rather than retaining normative PTY behavior.

Update `docs/architecture.md` with this component flow:

```text
OpenCode EventBus/client
  -> safe normalizer and snapshot reader
  -> parent-scoped SubagentRegistry
  -> SidebarObserver
  -> SubagentCard list in sidebar_content
```

Add `## Unreleased` to `CHANGELOG.md` with one breaking-change entry for the TUI migration and one security entry for allowlist/redaction.

- [ ] **Step 6: Run export, package, and stale-reference checks**

Run: `bun run build && bun test tests/index.test.ts`

Run: `rg -n "SubagentLifecycleManager|SubagentPaneAdapter|buildAttachPtyOptions|createOpenTuiSubagentPaneManager|resolveConnection|sibyl\.open|sibyl\.split|OPENCODE_SERVER_PASSWORD" src tests README.md SPEC.md docs/architecture.md package.json rollup.config.js`

Expected: the first command exits 0. The second command reports no matches except an intentional historical mention under the changelog/spec migration note; no source or test import remains.

- [ ] **Step 7: Commit migration cleanup when Git operations are authorized**

```bash
git add src tests rollup.config.js package.json README.md SPEC.md docs/architecture.md CHANGELOG.md
git commit -m "refactor!: SibylをObserver専用構成へ移行する"
```

### Task 9: Run Full Acceptance and Manual TUI Smoke Verification

**Stack layer:** `observer/migration`

**Files:**

- Modify only files implicated by failures from this task.

**Interfaces:**

- Consumes: the complete five-layer stack.
- Produces: repeatable evidence that the observer works through the rendered OpenTUI slot and that prohibited behavior is absent.

- [ ] **Step 1: Run the complete static and automated gate**

Run these commands independently so each failure is attributable:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

Expected: every command exits 0. Do not weaken or delete a failing test.

- [ ] **Step 2: Run a source and bundle prohibition scan**

```bash
rg -n "new PtyManager|new OpenTuiPaneBackend|route\.register|route\.navigate|keymap\.registerLayer|opencode attach|Bun\.Terminal|node-pty" src/tui.tsx src/subagent-integration.ts dist/tui.js
```

Expected: no matches.

- [ ] **Step 3: Drive the built plugin through a real OpenTUI render surface**

Run this smoke driver from the repository root:

```bash
bun --preload @opentui/solid/preload -e '
import "@opentui/solid/runtime-plugin-support";
import { testRender } from "@opentui/solid";
const { createTuiPlugin } = await import("./dist/tui.js");
let slot;
const disposers = [];
const eventHandlers = new Map();
const api = {
  slots: { register(plugin) { slot = plugin.slots.sidebar_content; return "sibyl-observer"; } },
  state: {
    config: {},
    session: { get() {}, messages() { return []; }, status() { return { type: "idle" }; } },
    part() { return []; },
  },
  client: {
    session: {
      async children() { return { data: [{ id: "child-1", parentID: "root", title: "child", slug: "child", projectID: "p", directory: ".", version: "1", time: { created: 1, updated: 2 } }] }; },
      async status() { return { data: { "child-1": { type: "busy" } } }; },
      async messages() { return { data: [{ info: { id: "user-1", sessionID: "child-1", role: "user", time: { created: 2 }, agent: "explore", model: { providerID: "openai", modelID: "gpt-5.6" } }, parts: [] }] }; },
      async message() { return { data: undefined }; },
    },
    event: { async subscribe() { return { stream: [] }; } },
  },
  event: {
    on(type, handler) {
      eventHandlers.set(type, handler);
      return () => eventHandlers.delete(type);
    },
  },
  theme: { current: { error: "red", warning: "yellow", info: "blue", success: "green", text: "white", textMuted: "gray", borderSubtle: "gray" } },
  lifecycle: { signal: new AbortController().signal, onDispose(fn) { disposers.push(fn); return () => {}; } },
};
const meta = {
  id: "sibyl-smoke",
  source: "file",
  spec: "./dist/tui.js",
  target: "./dist/tui.js",
  first_time: 1,
  last_time: 1,
  time_changed: 1,
  load_count: 1,
  fingerprint: "smoke",
  state: "first",
};
await Reflect.apply(createTuiPlugin({ env: { SIBYL_OBSERVER_ENABLED: "true" } }), undefined, [
  api,
  undefined,
  meta,
]);
if (!slot) throw new Error("sidebar_content was not registered");
const setup = await testRender(() => slot({ theme: api.theme }, { session_id: "root" }), { width: 42, height: 12 });
let frame = "";
for (let attempt = 0; attempt < 20; attempt += 1) {
  await setup.renderOnce();
  await Promise.resolve();
  frame = setup.captureCharFrame();
  if (frame.includes("explore") && frame.includes("BUSY")) break;
}
if (!frame.includes("explore")) throw new Error(`Missing child card:\n${frame}`);
if (!frame.includes("BUSY")) throw new Error(`Missing runtime status:\n${frame}`);
eventHandlers.get("message.part.updated")?.({
  type: "message.part.updated",
  properties: { sessionID: "child-1", part: null },
});
await setup.renderOnce();
const frameAfterMalformedEvent = setup.captureCharFrame();
if (!frameAfterMalformedEvent.includes("explore")) {
  throw new Error(`Malformed event removed the child card:\n${frameAfterMalformedEvent}`);
}
setup.renderer.destroy();
for (const dispose of disposers) await dispose();
console.log(frame);
'
```

Expected: exit 0 and a captured sidebar frame containing the `explore` child card and `BUSY`, with no shell or PTY process spawned.

- [ ] **Step 4: Exercise one malformed event through the live attachment**

The same smoke driver retains EventBus handlers and sends this malformed event before destroying the renderer:

```js
eventHandlers.get("message.part.updated")?.({
  type: "message.part.updated",
  properties: { sessionID: "child-1", part: null },
});
await setup.renderOnce();
const frameAfterMalformedEvent = setup.captureCharFrame();
if (!frameAfterMalformedEvent.includes("explore")) {
  throw new Error(`Malformed event removed the child card:\n${frameAfterMalformedEvent}`);
}
```

Expected: no throw, no raw payload text, and no extra card.

- [ ] **Step 5: Inspect stack state only when Git/PR operations are authorized**

```bash
gh stack view --json
```

Expected: the five branches appear in the declared bottom-to-top order, each PR base is the branch immediately below it, and no layer reports `needsRebase: true`.

- [ ] **Step 6: Submit draft stacked PRs only when explicitly requested**

```bash
gh stack submit --auto
gh stack view --json
```

Expected: one draft PR per branch. Do not merge any PR.

## Final Acceptance Checklist

- [ ] One, four, and eight direct children render; eight cards are scrollable.
- [ ] Events arriving during initial hydration or resync are replayed after the snapshot in source order.
- [ ] Parent changes show only the newly selected parent's direct children.
- [ ] Agent resolution is AgentPart, then Subtask, then UserMessage.
- [ ] Model resolution is newest Assistant provider/model, then UserMessage model.
- [ ] Status normalization covers busy, idle, retry, error, and unknown.
- [ ] A tool transitions pending → running → completed/error without duplicate activity identities.
- [ ] Assistant text and explicitly public reasoning summaries are redacted before truncation and conditionally rendered.
- [ ] Session/message/part IDs and agent/provider/model/tool names are redacted and syntax-checked before storage; secret-like identifiers are dropped or shown as `unknown`.
- [ ] Raw reasoning, tool payloads, output, errors, titles, attachments, metadata, credentials, and environment values are never inspected for projection and never enter a Registry snapshot or rendered frame.
- [ ] Deletion is immediate; idle retention obeys 0 through 3,600,000 ms.
- [ ] Active entries are never evicted at capacity; overflow is one bounded aggregate counter.
- [ ] Initial snapshot `omittedCount` is visible in the first ready Registry snapshot without cumulative resync double-counting.
- [ ] Deleting a known capacity-omitted child tombstones it so a stale resync cannot resurrect it.
- [ ] Hidden/omitted direct children are reconsidered after deletion, retention expiry, parent change, and resync.
- [ ] Malformed events and event bursts do not crash the TUI or exceed declared memory bounds.
- [ ] The TUI registers only `sidebar_content` and constructs no route, keymap, PTY, pane backend, shell, or attach process.
- [ ] Legacy values emit one warning per startup and do not alter any observer value or behavior.
- [ ] `bun run lint`, `bun run typecheck`, `bun run test`, and `bun run build` all exit 0.
- [ ] The manual OpenTUI smoke driver renders a real child card and survives a malformed event.
