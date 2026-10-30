# OpenCode V2 Migration Design

## Status and purpose

The migration approach was approved in conversation on 2026-10-29.
The written design was approved in conversation before implementation planning.
It proposes a V2-only host integration while retaining Sibyl's read-only
Observer behavior and its existing safety and bounded-state guarantees.

The existing [product specification](../../../SPEC.md) describes the V1-host
baseline. This document describes the proposed migration delta. Implementation
must update that specification and the migration guide together so that this
historical design does not become a second permanent product contract.

## Intent and agreed constraints

- Preserve `master` as the OpenCode V1-compatible branch.
- Perform the migration on `feature/opencode-v2-migration`, starting from
  baseline commit `58992b6`.
- Target OpenCode `2.1.4`; V1 and earlier V2 adapters are not required.
- Preserve watchdog status and direct-child session visibility.
- Akane is being migrated in parallel. Its versioned local state-file contract
  remains the integration boundary; its implementation belongs to Akane.
- Keep secret redaction, parent isolation, bounded retention, and read-only
  behavior. Do not introduce session mutations, prompts, permission changes,
  model changes, processes, routes, or keymaps.
- Preserve existing user-owned untracked files without including them in this
  migration.

Sibyl's current package version is `2.0.0`. That product version does not imply
OpenCode V2 compatibility: the baseline declares OpenCode `^1.18.8`.
Release version assignment is separate from this design and must follow the
repository's release process.

## Baseline and evidence

The supplied [migration playbook][playbook] targets upstream tag `v2.1.4`,
commit `68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`.
The reviewed public [TUI definition][definition] exposes
`Plugin.define({ id, setup })`; the [TUI context][context] exposes `client`,
`data`, `options`, `theme`, and `ui.slot()`.

These are source-reviewed contracts, not proof that a published package or
installed host works. The inspected local OpenCode binary reports `1.19.0`.
An isolated `2.1.4` host is required for runtime acceptance without replacing
the active V1 installation or changing centrally managed configuration.

## Approach selection

The selected approach replaces the host integration with a V2-native boundary
and preserves the Registry and rendering components where their semantics
remain valid.

Alternatives considered:

- Rebuild directly around the V2 data store: larger change surface and greater
  risk of losing bounded-state and reconciliation guarantees.
- Maintain V1/V2 adapters: unnecessary compatibility cost for the agreed scope.

The V2 boundary is not a V1 compatibility shim. It converts public V2 records
into Sibyl's host-independent safe projections.

## Architecture and ownership

```text
V2 TUI Plugin.define setup
  -> validated options and environment
  -> V2 event source and snapshot reader
  -> safe projections
  -> parent-scoped SubagentRegistry
  -> ui.slot append sidebar.content
  -> IntegratedSidebar / SidebarObserver

Akane versioned state file
  -> validated, freshness-checked state
  -> visibility gate and watchdog display
```

### Entrypoints and dependencies

`src/tui.tsx` exports a definition from `@opencode/plugin/tui`, retaining the
stable plugin identity `oh-my-opencode.sibyl`. Its `setup(context)` owns
registration and returns an idempotent cleanup function.

The package retains the root Observer-core entrypoint and `./tui` entrypoint.
The root must remain usable without initializing Solid/OpenTUI rendering.
The implementation inventories exports and removes obsolete V1-only coupling.
Generic PTY utilities are not newly connected to the Observer; unrelated
utility removal is outside this migration.

Replace `@opencode-ai/plugin` with `@opencode/plugin@2.1.4`. Use
`@opencode/client@2.1.4` directly only where public client types are imported.
Declare the host compatibility floor as `>=2.1.4 <3`, with exact `2.1.4`
development artifacts. This range expresses policy, not a claim that every
future version was tested. Align OpenTUI/Solid peers and Rollup externals with
the installed V2 artifacts, preserving a single host rendering runtime.

### Slot, theme, and reactive identity

`src/subagent-integration.ts` registers an additive claim with
`append: "sidebar.content"`. The host's existing sidebar remains present.
The render callback receives `sessionID`, replacing V1's `session_id`.

Read the session identity reactively. A parent switch must clear the previous
view and invalidate its in-flight reads before admitting new results.
Map `context.theme` into the existing rendering needs without assuming the V1
theme shape or retaining a stale theme snapshot across reactive updates.

### Session reads, events, and reconciliation

`src/subagent-snapshot-reader.ts` uses public V2 client reads and, where
appropriate, `data.session` message/session accessors. Determine children by
exact parent identity and preserve ordering, hydration concurrency, and existing
message/part limits. Do not assume a V1 `children`, `status`, or `messages`
method exists with the same signature.

`src/subagent-event-source.ts` subscribes through `data.on` or `data.listen`.
Decode each typed V2 event by its actual schema, including session changes,
message changes, tool activity, failures, retries, and relevant removals.
Translate into the existing normalized domain events rather than passing raw
SDK objects into the Registry. Do not assume a uniform `properties` envelope
or use `session.idle` as an exactly-once completion signal.

The implementation must audit the `2.1` public-data changes, including `native`
replay fields and removed compaction events. Provider-owned data is excluded
from projection; tool execution state is a distinct field and must not be
renamed mechanically. Reasoning is displayed only when a verified public-summary
contract exists. Raw reasoning must never substitute for a missing summary.

Reconcile on initial selection, parent changes, and transport recovery. If the
public TUI surface provides no verified reconnect notification, reconcile every
five seconds while a parent is selected and Akane state is available. Coalesce
requests without overlapping snapshot reads, clear the timer on cleanup, and
reconcile immediately when Akane becomes available again. Duplicate and
reordered events must not create duplicate cards or revive deleted state.

### Configuration

The V2 configuration precedence is:

```text
SIBYL_OBSERVER_* > context.options.observer > defaults
```

Retain the nine Observer settings, their defaults, validation ranges, and
failure-on-invalid-selected-value behavior. Observer remains disabled by
default. Migrate `sibyl.observer` examples to V2 plugin options because the
public TUI context has no V1 `state.config` surface.

Remove V1 host-config reads and obsolete compatibility detection/warnings.
Document the explicit configuration move rather than silently importing V1
settings or credentials. Installation examples must use the verified V2
terminal configuration schema; local plugin package references must point to
directories, not individual TypeScript files.

### Akane, location, and display metadata

Keep `.akane/watchdog-state.json`, state schema version `1`, enabled gating,
90-second freshness tolerance, and 30-second future-clock tolerance.
Missing, invalid, disabled, or stale state hides both watchdog and Observer
views. The state-file version is independent of OpenCode's major version.

Resolve the displayed session's location through public V2 session/location
data, not process working directory or an unconditional default location.
For sessions whose location cannot be established, hide the location-dependent
view until it can be resolved rather than reading another project's state.
Preserve worktree/directory state selection within the verified session scope.

Port existing branch/worktree labels, agent colors, and category display using
public V2 APIs and the existing metadata boundaries. Optional missing color or
category data omits that decoration without breaking the sidebar. Category
resolution must not retain or log raw tool input; existing local metadata reads
remain read-only and must be scoped to the selected session's location.

## Lifecycle, failures, and safety

Plugin setup owns an AbortController, unsubscribe functions, the slot disposer,
Registry stop, and any polling timers. Component-local cleanup releases its
own polling and subscriptions when the slot unmounts. Plugin cleanup also stops
remaining resources; repeated cleanup is harmless.

Setup failure releases resources acquired before the failure. Abort pending
reads where the public client supports cancellation and use generation checks
to reject late results regardless. After cleanup, no callback can repopulate
the Registry or update disposed signals.

Malformed records are ignored. Recoverable read failures use sanitized error
categories and permit later reconciliation. Invalid configuration rejects
setup before allocating subscriptions. Never log SDK payloads, credentials,
tool arguments/results/errors, or raw reasoning.

Required behavior lacking a verified public V2 equivalent is recorded as
blocked, not implemented through private APIs or silently removed.

## Migration inventory and documentation

Inventory each host-facing capability with its owning V2 surface, migration
decision, source evidence, tests, and residual limitations. Include TUI, core
exports, configuration, event/state readers, category metadata, Akane state,
theme, resource cleanup, build externals, and package loading.

Record reasoned non-applicability for unused server hooks, authentication,
credential activation, provider/model policy, LSP, custom tools, RPC, MCP, and
compaction execution. Observing model identifiers does not mean Sibyl owns
provider selection. Event/data decoding is still audited independently.

Update `SPEC.md` as the canonical product contract, `docs/architecture.md` for
explanation, and `docs/migration.md` for migration instructions and an evidence
ledger. Keep README onboarding concise and route to these documents. Use
English for canonical new documentation under the repository standard.

## Acceptance and verification

1. Unit tests cover V2 record/event conversion, parent/location isolation,
   configuration precedence, redaction, capacity limits, retries, removals,
   malformed inputs, cancellation, and late-result suppression.
2. Integration tests cover real V2 context types, slot registration, reactive
   parent changes, Akane visibility, partial setup failure, unmount, unload,
   repeated cleanup, and reconnection or periodic reconciliation.
3. OpenTUI rendering tests exercise watchdog and child-session cards, optional
   decorations, theme handling, and absence of secret-bearing content.
4. Run all repository gates: `bun run lint`, `bun run typecheck`,
   `bun run test`, and `bun run build`.
5. Inspect the built/package artifacts: public entrypoints resolve, the core
   entry does not initialize rendering, V1 SDK imports are absent, and host
   rendering dependencies are externalized.
6. Load the built package in an isolated real OpenCode `2.1.4` TUI. Verify
   sidebar composition, child activity updates, parent switching, and unload.
   Record host/package versions, platform, invocation, and observed results.
7. Separately run the same host with migrated Akane and exercise state
   creation, freshness loss, recovery, and cross-location isolation. A synthetic
   state fixture does not constitute Akane V2 integration acceptance.

For each applicable playbook gate record PASS, FAIL, BLOCKED, or reasoned N/A
with supporting evidence. Passing types or fixtures is not real-host proof.
If the pinned host/artifact or parallel Akane build is unavailable, complete
the independently verifiable work and explicitly leave the corresponding
runtime gate blocked; do not report the migration as fully verified.

## Review boundary

Written-spec approval permits implementation planning. Product code and
dependency changes follow only after the implementation plan is reviewed and
its execution method is selected. Commit, push, release, and merge operations
require their own explicit authorization under repository instructions.

[playbook]: https://gist.githubusercontent.com/yohi/0c3d8edea98d86e7f5c8d6c2d9f93d2d/raw/e1cb243caed8dfef3903dd4560f08e7822e25328/MIGRATION.md
[definition]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/tui/plugin.ts
[context]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/tui/context.ts
