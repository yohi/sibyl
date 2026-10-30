# OpenCode V2 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development or superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Run Sibyl's read-only watchdog and direct-child Observer on OpenCode
`2.1.4` using only public V2 interfaces.

**Architecture:** Replace the V1 host boundary with native V2 record projection,
client reads, event decoding, and slot lifecycle. Preserve host-independent
Registry bounds, redaction, and rendering behavior. Keep Akane integration on
its existing versioned local state file.

**Tech Stack:** Bun, strict TypeScript, Solid, OpenTUI, Rollup, Biome,
`@opencode/plugin@2.1.4`, `@opencode/client@2.1.4`.

**Spec:** [Approved migration design](../specs/2026-10-29-opencode-v2-migration-design.md).

## Global constraints

- Work on `feature/opencode-v2-migration`; preserve `master` at `58992b6`.
- Target OpenCode `2.1.4`; declare host policy `>=2.1.4 <3`; no V1 adapters.
- Pin development SDK artifacts to `2.1.4`; externalize host rendering runtimes.
- Keep plugin identity `oh-my-opencode.sibyl` and root plus `./tui` exports.
- Keep Observer defaults and limits from `SPEC.md`: 8 visible, 64 tracked,
  5 activity entries, 300000 ms retention; message/part bounds 32/64 and
  hydration concurrency 8. Preserve all configurable validation ranges.
- Keep `SIBYL_OBSERVER_* > context.options.observer > defaults`.
- Keep `.akane/watchdog-state.json` schema version `1`, 90000 ms freshness,
  and 30000 ms future-clock tolerance. Akane migration is separate work.
- No prompt/session/permission/model mutations, routes, keymaps, or processes
  in the Observer path. Never retain SDK payloads or raw reasoning/tool data.
- Do not create agent configuration files, modify central settings, replace
  the installed V1 host, or touch existing user-owned untracked documents.
- Do not commit, push, publish, or merge without explicit user authorization.
  Commit steps from generic workflows are intentionally omitted here.
- Run `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`.
- A passing fixture is not host acceptance. Record unavailable runtime gates
  as BLOCKED; unused feature gates need evidence-backed N/A reasons.

## Review focus

1. Session moves during pending reads: discard old location data and never
   show another project's Akane state (Tasks 3 and 5).
2. Message content shrinks or tool content is reordered: replace obsolete
   projections without duplicate activity or stale text (Tasks 2 and 4).
3. A source event arrives before the host cache updates: authoritative client
   reads and eventual reconciliation must converge (Tasks 3 and 4).
4. A second slot mount or cleanup races with setup failure: independent
   component ownership and idempotent plugin teardown (Task 5).
5. A stale retry/error exists in message history after successful execution:
   current execution state must win over historical failures (Tasks 3 and 4).

## Source-verified API decisions

Use upstream tag `v2.1.4`, SHA
`68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`.
The reviewed public files are `packages/plugin/src/tui/{plugin,context}.ts`,
`packages/client/src/promise/generated/{client,types}.ts`, and
`packages/schema/src/{event,session,session-event,session-message}.ts`.

- `Plugin` is a namespace export of `@opencode/plugin/tui`.
- `Plugin.Context` has `data`, `client`, `options`, `theme`, `ui`; it has no
  V1 `state`, `event`, `slots`, or `lifecycle` fields.
- `data.listen(handler)` receives `{ details: OpenCodeEvent }` and returns an
  unsubscribe function. Public session events use `data` with typed payloads.
- `client.session.list({ parentID, limit, order, cursor }, { signal })`
  returns `{ data: SessionInfo[], cursor: { previous?, next? } }`.
- `client.session.get({ sessionID }, { signal })` returns `SessionInfo`
  directly; `client.session.active({ signal })` returns an ID-keyed map.
- `client.message.list({ sessionID, limit: 32, order: "desc" }, { signal })`
  returns `{ data: SessionMessageInfo[], cursor: { previous?, next? } }`.
  `client.session.message.get()` returns
  a message directly. These are not V1 `{ info, parts }` bundles.
- Session messages use `type`, not `role`; assistant content is `content[]`.
  Messages do not carry `sessionID`; supply it from the owning request.
  Model references use `{ id, providerID }`. Tool content uses `name`, `id`,
  `state.status`, and `time.{created,ran,completed}`.
- `SessionInfo.location.directory` is session-specific. Use
  `client.location.get({ location: session.location }, { signal })` for
  project/worktree context; never substitute the plugin default location.
- The reviewed reasoning record has raw `text` and `native`, with no public
  summary fields. Keep `showReasoningSummary` accepted but emit no reasoning
  projection on `2.1.4`; document this release limitation explicitly.

Published artifacts must independently confirm these signatures. If they
disagree, stop that capability and record the discrepancy instead of casting
or importing private source.

## File and interface map

| File | Responsibility |
| --- | --- |
| `src/tui.tsx` | V2 definition, options, setup rollback and cleanup |
| `src/subagent-config.ts` | Options/environment validation; remove V1 reads |
| `src/subagent-normalizer.ts` | Safe session/message projections |
| `src/subagent-v2-content.ts` (new) | Safe assistant-content replacement |
| `src/subagent-snapshot-reader.ts` | V2 pagination, bounded hydration and status |
| `src/subagent-event-source.ts` | V2 listener and normalized notifications |
| `src/subagent-registry.ts` | Atomic message replacement and refresh races |
| `src/subagent-reconciler.ts` (new) | Coalesced five-second resynchronization |
| `src/subagent-integration.ts` | Additive slot and resource ownership |
| `src/integrated-sidebar.tsx` | Reactive session/location/Akane display |
| `src/tui-category.ts` | Host-independent category observations |
| `src/subagent-observer.tsx`, `src/akane-sidebar.tsx` | V2-compatible theme inputs |
| `src/index.ts` | Host-independent public export consistency |
| `tests/helpers/opencode-v2.ts` (new) | Typed V2 fixtures and narrow mocks |
| `tests/opencode-v2-package.test.ts` (new) | Dependency/export/build contracts |
| `tests/subagent-reconciler.test.ts` (new) | Deterministic timer/race tests |
| `tests/opencode-v2-host.test.ts` (new) | Opt-in isolated real-host acceptance |
| `docs/migration.md` (new) | Inventory, instructions and evidence ledger |

Keep changed modules focused. Split content projection and reconciliation as
listed instead of expanding already-large Registry/event modules unnecessarily.

### Task 1: Establish package contracts and migration inventory

**Files:** Modify `package.json`, `bun.lock`, `rollup.config.js`; create
`tests/opencode-v2-package.test.ts`, `tests/helpers/opencode-v2.ts`,
`docs/migration.md`.

**Interfaces:** Produce typed `makeSession(overrides?: Partial<SessionInfo>):
SessionInfo` and `makeAssistant(overrides?: Partial<SessionMessageAssistant>):
SessionMessageAssistant` fixtures using public client types. Narrow fake client
members must satisfy the corresponding `OpenCodeClient` member signatures.

- [ ] Write a package-contract test asserting host range `>=2.1.4 <3`, exact
  V2 development dependencies, absence of V1 SDK dependencies, and both export
  paths. Run `bun test tests/opencode-v2-package.test.ts`; expect failure on
  the current V1 dependency metadata.

  ```typescript
  expect(manifest.engines.opencode).toBe(">=2.1.4 <3");
  expect(manifest.devDependencies["@opencode/plugin"]).toBe("2.1.4");
  expect(manifest.devDependencies["@opencode/client"]).toBe("2.1.4");
  expect(manifest.peerDependencies["@opencode-ai/plugin"]).toBeUndefined();
  ```

- [ ] Inspect published `2.1.4` package exports/peer constraints, then update
  dependencies with Bun and regenerate `bun.lock`. Retain unrelated optional
  PTY dependencies. Use compatible OpenTUI versions meeting V2's `>=0.6.8`
  floor and verify Solid peer requirements; record exact resolved versions.
  An unavailable package is a blocker, not permission to use `latest`.
- [ ] Change Rollup externals to cover `@opencode/*` and all subpaths,
  `@opentui/*`, `solid-js` and subpaths, plus existing `node-pty`. Do not bundle
  a second Effect runtime if transitive APIs expose it.
- [ ] Implement the typed fixture factories; no `as any`, suppression comments,
  or broad fake `Plugin.Context` assertions. Record every host-facing feature
  as PORT/PARTIAL/BLOCKED or approved REMOVE and unused features as N/A in
  `docs/migration.md`. Reasoning summary is PARTIAL, never a fabricated field.
- [ ] Run the package-contract test; expect PASS. Record intermediate V1 source
  type errors as migration work owned by the following tasks, not as completed
  repository-wide validation.

### Task 2: Port options and safe record/content projection

**Files:** Modify `src/subagent-config.ts`, `src/subagent-normalizer.ts`,
`src/subagent-types.ts`, `src/index.ts`; create `src/subagent-v2-content.ts`;
update `tests/subagent-config.test.ts`, `tests/subagent-normalizer.test.ts`,
`tests/index.test.ts`.

**Interfaces:** `resolveObserverConfig({ pluginOptions?: unknown, env:
Readonly<Record<string, string | undefined>> }): ObserverConfig`;
`projectMessage(value: unknown, sessionId: string):
SafeMessageProjection | undefined`;
`projectAssistantContent(value: unknown, context: { readonly sessionId:
string; readonly messageId: string; readonly observedAt: number }):
readonly SafePartProjection[]`. Keep `projectSession()` and existing safe
identifier/redaction helpers. Remove V1 `projectPart` export and update callers.

- [ ] Add failing tests for options precedence, all nine defaults/ranges,
  invalid selected environment values without fallback, and absence of host
  config reads/deprecation warnings. Run
  `bun test tests/subagent-config.test.ts`; expect the V1 API contract to fail.

  ```typescript
  expect(resolveObserverConfig({ env: {} }).enabled).toBe(false);
  expect(resolveObserverConfig({
    pluginOptions: { observer: { maxVisibleSubagents: 2 } },
    env: { SIBYL_OBSERVER_MAX_VISIBLE_SUBAGENTS: "3" },
  }).maxVisibleSubagents).toBe(3);
  expect(() => resolveObserverConfig({
    env: { SIBYL_OBSERVER_ENABLED: "invalid" },
  })).toThrow();
  ```

- [ ] Implement the V2-only config signature. Delete `hostConfig` and
  `legacySettingsDetected` wiring; keep validation of capacity and types.
- [ ] Add typed V2 fixture tests: assistant `agent` and `model.id/providerID`,
  explicit owning session ID, safe text redaction at 160 characters, unsafe
  identifiers rejected at existing limits, and user/system/synthetic text
  excluded. Assert `JSON.stringify(projection)` contains none of injected
  `native`, tool input/content/error, metadata, or reasoning sentinels.
- [ ] Implement content projection. Use tool IDs for tool activity identity;
  map `streaming` to `pending`, preserve other tool states, and take timestamps
  from the tool's own time fields. Non-tool content IDs are
  `${messageId}:content:${index}` and stay within the correlation-ID limit.
  Skip reasoning entirely. Supply an assistant's agent in its safe message
  projection and make Registry agent precedence consume it in Task 4.
- [ ] Run `bun test tests/subagent-config.test.ts
  tests/subagent-normalizer.test.ts tests/index.test.ts`; expect PASS after
  updating the root export assertions to the explicit V2 core API.

### Task 3: Implement authoritative V2 snapshots and session location

**Files:** Modify `src/subagent-snapshot-reader.ts`; update
`tests/subagent-snapshot-reader.test.ts`; use Task 1 fixtures.

**Interfaces:** Keep `ObserverSnapshotReader.readParent()` and `readMessage()`
domain signatures. Replace V1 dependency interfaces with
`SnapshotClient = Pick<OpenCodeClient, "session" | "message">`;
`createOpenCodeSnapshotReader({ client: SnapshotClient, logger:
SubagentLogger }): ObserverSnapshotReader`. Export
`readSessionLocation(client: Pick<OpenCodeClient, "session" | "location">,
sessionId: string, signal: AbortSignal): Promise<LocationPublicInfo | undefined>`
from this file; missing/deleted session returns undefined, other failures are
sanitized by the caller. No default-location fallback.

- [ ] Add failing tests with two child pages: wrong-parent children are dropped,
  late pages still affect urgency selection, and only the best
  `maxTrackedSubagents` are hydrated. Run
  `bun test tests/subagent-snapshot-reader.test.ts`; expect V1 call mismatches.

  Use test name `selects urgent later-page children within capacity`; with
  capacity 8, eight idle children on page one and one busy child on page two:

  ```typescript
  expect(snapshot.children).toHaveLength(8);
  expect(snapshot.children[0]?.session.id).toBe("ses_busy");
  expect(snapshot.omittedCount).toBe(1);
  expect(maximumConcurrentMessageReads).toBeLessThanOrEqual(8);
  ```

- [ ] Implement parent-filtered `session.list()` pagination with page limit
  256 and only current/next cursor retention. Keep a bounded top-K candidate
  set and aggregate omission count. Reject a repeated non-advancing cursor
  rather than looping. Do not store all child IDs across pages.
- [ ] Read the active map once per parent snapshot; retain only candidate
  membership. Read at most 32 newest messages per selected child with
  concurrency 8; project into at most 64 content references. API responses
  remain temporary, never Registry state. `readMessage` uses
  `client.session.message.get({ sessionID, messageID }, { signal })`.
- [ ] Add tests for aborted pagination/hydration, wrapped transport aborts,
  late promises, deleted parent, unknown/moved session location, and no call
  using an unrelated plugin directory. Implement location lookup via session
  then location read, forwarding the same signal and rechecking cancellation.
- [ ] Add status assertions: active session maps to busy unless its current
  assistant has a pending retry; failed terminal outcome maps to error;
  succeeded/interrupted terminal outcomes map to idle; missing information
  maps to unknown. Only retry/error evidence newer than the last idle marker
  may override current state. Never let a historical failed message make a
  later successful run error forever.

  When active evidence is absent but session outcome says a run ended, use
  that outcome only if its idle watermark is at least as new as the newest
  assistant message; otherwise return unknown until a later refresh.
- [ ] Run snapshot tests; expect PASS for paging, bounds, location, status,
  abort and sanitized failure paths.

### Task 4: Port live events and coalesced reconciliation

**Files:** Modify `src/subagent-event-source.ts`, `src/subagent-registry.ts`;
create `src/subagent-reconciler.ts`; update event/Registry tests and create
`tests/subagent-reconciler.test.ts`.

**Interfaces:** Keep `ObserverEventSource` and existing normalized events.
Add normalized `message.refresh` carrying `sessionId`, `messageId`, `sequence`,
`observedAt`. Replace `TuiEventBusSource` with `V2EventSource` taking
`{ data: Pick<Plugin.Context["data"], "listen">; logger: SubagentLogger }`.
Produce `createObserverReconciler({ refresh: () => Promise<void>; logger:
SubagentLogger }): { setActive(active: boolean): void; request(): void;
stop(): Promise<void> }`, with injectable timer functions for tests.

- [ ] Write failing event fixtures for `session.created/deleted/moved/forked`,
  `session.status`, `session.execution.*`, `session.retry.scheduled`,
  `session.step.*`, `session.text.*`, `session.tool.*`,
  `session.compaction.ended`, and `session.revert.committed`. Verify dispatch
  uses `details.type` and the corresponding `details.data` shape. Run event
  tests; expect V1 subscription/envelope failures.
- [ ] Implement `data.listen` with one owned unsubscribe. Session structure,
  selection, move and revert changes request parent resync through
  `onReconnectRequired`. Execution/status/retry events emit normalized states;
  text/tool/step events with `assistantMessageID` emit `message.refresh`.
  Ignore reasoning and tool-input delta text. No raw payload accumulation.
- [ ] Implement Registry message refresh as an authoritative read through
  Task 3. Atomically replace that message's safe parts, including removal of
  references missing from the new content array. Deduplicate in-flight work
  by tracked session/message, retain only bounded keys, and re-read once if
  another event arrived during the read. Generation checks prevent old parent
  or stopped results being applied. Use assistant agent candidates from Task 2.
- [ ] Add tests for duplicate/reordered events, missing tool-start events,
  message content shrink/reordering, stale host cache, moved/deleted children,
  historical retry after success, and maximum refresh-map size. Expect no
  duplicate history or resurrected deleted state. Keep SSE source only as a
  V2-decoding core export; it must not open a new transport from TUI setup.
- [ ] Implement reconciler: immediate refresh on inactive-to-active, then every
  5000 ms; maximum one refresh running and one dirty follow-up; inactive state
  clears timers/queued work; stop is idempotent and waits for owned work.
  Use fake clocks to assert 4999 ms does not poll, 5000 ms does, simultaneous
  ticks coalesce, failure permits the next tick, and stop cannot restart work.

  Name the clock test `polls only at five seconds and cannot restart after stop`;
  after resolving the immediate refresh and advancing 4999 ms, then 1 ms:

  ```typescript
  expect(refreshCountAt4999).toBe(1);
  expect(refreshCountAt5000).toBe(2);
  expect(maximumConcurrentRefreshes).toBe(1);
  expect(refreshCountAfterStopAndFurtherTicks).toBe(2);
  ```

- [ ] Run `bun test tests/subagent-event-source.test.ts
  tests/subagent-registry.test.ts tests/subagent-reconciler.test.ts`;
  expect PASS and bounded pending work under event bursts.

### Task 5: Wire the V2 slot, display metadata, and complete lifecycle

**Files:** Modify `src/tui.tsx`, `src/subagent-integration.ts`,
`src/integrated-sidebar.tsx`, `src/tui-category.ts`,
`src/subagent-observer.tsx`, `src/akane-sidebar.tsx`; update `tests/tui.test.ts`,
`tests/subagent-integration.test.ts`, `tests/subagent-observer.test.tsx`,
`tests/tui-category.test.ts`, `tests/akane-state.test.ts` and helper fixtures.

**Interfaces:** `createTuiPlugin(deps?: TuiPluginDependencies):
Plugin.Definition`; `attachSubagentIntegration(context:
ObserverIntegrationApi, config: ObserverConfig, deps?:
ObserverIntegrationDependencies): Promise<ObserverIntegrationHandle>`;
`ObserverIntegrationApi = Pick<Plugin.Context, "client" | "data" | "ui" |
"theme">`. The integration owns its controller and returns `stop()`;
`createTuiPlugin.setup` returns that cleanup. Category types are owned local
safe records, not V1 `Part`/`Session` SDK types.

- [ ] Add failing setup tests for stable ID, returned cleanup, no allocation
  before config validation, and one `ui.slot({ append: "sidebar.content",
  render })` claim. Observe real slot render inputs rather than calling a
  fabricated V1 slot API. Run `bun test tests/tui.test.ts`; expect FAIL.

  ```typescript
  expect(definition.id).toBe("oh-my-opencode.sibyl");
  expect(claims).toHaveLength(1);
  expect(claims[0]?.append).toBe("sidebar.content");
  expect(typeof cleanup).toBe("function");
  ```

- [ ] Implement the V2 definition and composition. Treat props.sessionID as
  reactive; remount keyed parent content on identity change. Resolve Task 3's
  session location before reading Akane files. Key asynchronous decorations
  by session and location generation; use `data.location.vcs.info(location)`
  and `data.location.agent.list(location)` for labels/colors, with public
  client reads when necessary. Read `context.theme` reactively.
- [ ] Preserve Akane polling at 1000 ms and optional color refresh at 30000 ms.
  Drive Task 4's reconciler only when Observer is enabled, a parent exists,
  and Akane is ready. Missing state hides views and disables snapshot polling;
  recovered state requests immediate reconciliation. Observer disabled still
  permits the watchdog slot without creating Registry/source.
- [ ] Port category observations from `session.tool.input.started/called/
  success/failed` and authoritative assistant content. Bound transient
  tool-name correlation, parse only the existing category/task identifiers,
  and discard raw input immediately. Resolve optional session titles safely.
  Local task files use the verified session directory; global runtime
  categories are accepted only for already-verified direct child IDs.
- [ ] Implement rollback and ownership tests: slot registration throws after
  source creation, two mounts then one unmounts, parent moves during color
  lookup, cleanup called twice, cleanup during hydration, and late callback
  after stop. Attempt each disposer even if another fails; unsubscribe and
  clear component timers on unmount and plugin unload.
- [ ] Render watchdog and child cards with real OpenTUI test rendering. Assert
  90000/90001 ms freshness and 30000/30001 ms future boundaries; invalid state
  hides both views; labels, color/theme changes and category fallback work;
  raw reasoning and secret sentinels never appear. Update assertions for the
  intentionally unavailable public summary.
- [ ] Run `bun test tests/tui.test.ts tests/tui-category.test.ts
  tests/akane-state.test.ts`, then
  `bun test --conditions=browser --preload @opentui/solid/preload
  tests/subagent-integration.test.ts tests/subagent-observer.test.tsx`;
  expect PASS. Perform terminal visual QA using the applicable visual-QA skill
  before declaring rendering verified.

### Task 6: Verify artifacts and real-host acceptance

**Files:** Extend `tests/opencode-v2-package.test.ts`; create
`tests/opencode-v2-host.test.ts`; modify `package.json` test script if needed;
update `docs/migration.md` evidence ledger.

**Interfaces:** Add `test:host:v2` running the opt-in host test explicitly;
normal tests skip it unless `SIBYL_V2_HOST_TEST=1`. Read the isolated binary
path from `SIBYL_V2_HOST_BIN` and migrated Akane package directory from
`SIBYL_V2_AKANE_PACKAGE`. Never print inherited environment values.
Artifact-dependent assertions run only when `SIBYL_V2_ARTIFACT_TEST=1`;
add `test:package:v2` to build first and then run that test with the flag.
Ordinary unit tests must not depend on pre-existing `dist` output.

- [ ] Add artifact assertions for both built exports, core import without
  rendering initialization, stable plugin definition, absent `@opencode-ai/`
  references, and externalized V2/Solid/OpenTUI imports. Run the artifact test
  against a fresh build, not stale `dist` output.

  ```typescript
  expect(builtTui.default.id).toBe("oh-my-opencode.sibyl");
  expect(typeof builtTui.default.setup).toBe("function");
  expect(bundleText.includes("@opencode-ai/")).toBe(false);
  ```

- [ ] Run `bun run lint`, `bun run typecheck`, `bun run test`, and
  `bun run build`. Resolve migration-caused failures; record unrelated baseline
  informational diagnostics separately. Inspect tracked diff for generated
  or unrelated changes and check the public-export tests again after build.
  Run `bun run test:package:v2`; expect fresh-build artifact assertions to pass.
- [ ] Implement the host harness only against the pinned host's actual
  documented CLI/config schema: validate binary version is exactly `2.1.4`,
  launch in isolated temporary HOME/XDG directories, and load the built
  package. Do not create project agent configuration files. If V2 requires a
  temporary configuration covered by the global prohibition, obtain explicit
  owner approval or use supported options/terminal configuration; never
  silently bypass that rule. Process creation here is test-harness behavior,
  not Observer behavior, and must terminate on every exit path.
- [ ] Exercise actual TUI loading, additive sidebar, parent/child activity,
  parent switching, cancellation, and unload. A test driver may seed isolated
  sessions; the plugin must make only allowlisted read requests. Keep test
  payloads synthetic and record observed results plus version/platform and
  invocation. If terminal driving is needed, use the available PTY/tmux tools.
- [ ] Run the host with migrated Akane separately; verify state production,
  freshness loss/recovery and distinct project locations. A fixture-only
  watchdog run is not a PASS here. Missing host, unavailable package, or
  unavailable migrated Akane is BLOCKED with the exact missing prerequisite.
- [ ] Populate all applicable G1-G21 playbook gates with evidence links and
  conditional N/A reasons. Recheck no stronger compatibility/runtime claim
  appears than the actual evidence supports.

### Task 7: Publish the migration contract in repository documentation

**Files:** Modify `SPEC.md`, `README.md`, `docs/architecture.md`, `CHANGELOG.md`,
`docs/WORKING_RULES.md`; complete `docs/migration.md`.

**Interfaces:** `SPEC.md` is the canonical product contract; the migration guide
owns upgrade instructions and the evidence ledger. No duplicated normative
contract in the historical design or README.

- [ ] Update V2 lifecycle/API/slot terminology, exact configuration precedence,
  session-scoped location rules, periodic reconciliation, public-summary
  limitation, and retained safety/bounds in canonical English documentation.
  Replace V1 `onDispose` guidance in `docs/WORKING_RULES.md` with owned setup
  cleanup. Keep this change limited to migration-relevant instructions.
- [ ] Document V1 on `master`, the V2 support policy and tested exact version,
  Akane prerequisite, plugin-options conversion and verified terminal config
  examples. Preserve product version `2.0.0` until explicitly authorized release
  work assigns a new version. Add migration notes under unreleased changelog.
- [ ] Check relative links, Markdown structure, placeholders, machine-specific
  paths, and evidence labels. Run markdownlint-cli2 on changed Markdown if
  available; otherwise record the manual checks. If Japanese localization is
  added, scan for Hangul and non-Japanese Han characters before finishing.
- [ ] Run the four required repository gates after the final changes. Compare
  the final diff against the approved spec and inventory; retain blockers
  honestly. Request the applicable independent review workflow before any PR
  handoff; CodeRabbitCLI remains prohibited without explicit authorization.
- [ ] Report changed files, test counts, exact host/Akane evidence, and remaining
  blockers. Leave commit/push/merge pending explicit authorization.

## Self-review and execution handoff

- Spec coverage: dependency/entrypoint, slot/theme, records/events, config,
  Akane/location, category metadata, lifecycle, bounds, and acceptance each
  have an owning task above.
- Type consistency: host types come from public `2.1.4` artifacts; message
  ownership is explicit; later tasks consume the domain interfaces defined
  in Tasks 2-4 rather than reintroducing V1 SDK shapes.
- Review-focus coverage: each of the five conditions has explicit tests in
  the owning task. Summary absence and missing real-host prerequisites are
  reported limitations, not inferred successes.
- Execution order: Tasks 1-7 are sequential because data shapes and lifecycle
  interfaces are shared. Prefer native execution in this session, with a
  fresh whole-branch review after the gates, to avoid handoff drift.
- Implementation starts only after plan review and execution-method selection.
  This plan's creation does not authorize product code changes or Git commits.
