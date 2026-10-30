# Sibyl Architecture

Sibyl is an OpenCode V2 TUI plugin. Its core projection and Registry remain
host-independent; the TUI adapter uses only public `@opencode/plugin/tui` and
`@opencode/client` interfaces.

## Data flow

```text
Plugin.define setup
  -> validated plugin options
  -> append claim for sidebar.content
  -> selected session and resolved V2 location
  -> Akane state gate
  -> V2 event listener and paged snapshot reader
  -> safe projections
  -> parent-scoped SubagentRegistry
  -> SidebarObserver and AkaneSidebar
```

## Components

- `tui-v2.tsx` declares the stable plugin ID, parses `context.options`, and
  owns the slot registration disposer.
- `sidebar-v2.tsx` resolves current session location, reads Akane state, adapts
  the V2 theme, decorates cards with optional category/agent color data, and
  owns listener/timer/abort cleanup.
- `subagent-v2-events.ts` decodes V2 event envelopes. It retains no raw event
  or delta payload; changes needing message details trigger an authoritative
  V2 message read.
- `subagent-v2-snapshot.ts` pages direct children, selects top-K by status and
  update time, hydrates at concurrency 8, and enforces message/part limits.
- `subagent-v2-content.ts` converts V2 assistant `content[]` into allowlisted
  safe text/tool projections. V2.1.4 raw reasoning is not projected.
- `subagent-registry.ts` merges initial snapshot, bounded events, refreshes,
  retention, tombstones, and resync into immutable views.
- `subagent-reconciler.ts` coalesces immediate and five-second resync requests.
- `akane-state.ts` validates the independent Akane state-file schema and
  freshness boundary.

## Ownership and cleanup

The plugin's setup cleanup disposes the V2 slot, then awaits mounted sidebar
cleanups. Each sidebar owns its `data.listen` unsubscribe, location request
abort controller, Akane timer, Registry, and reconciler. Parent changes abort
the previous location request; Registry selection generation rejects stale
snapshot results. Cleanup is idempotent and late callbacks cannot publish UI
state.

The Observer does not create a server client or use a private transport. It
reads the current session's location and exact direct children through public
host APIs. A missing session/location does not fall back to cwd.

## Bounded state

The normative limits and eviction policy are in [SPEC.md](../SPEC.md). In
summary, tracked children are capped at `maxTrackedSubagents`; visible cards at
`maxVisibleSubagents`; messages/parts at 32/64; hydration concurrency at 8;
and history at `activityLimit`. Pending events, refresh work, tombstones, and
omitted IDs have explicit bounds. Overflow is an aggregate counter.

## Current limitations

- OpenCode V2.1.4 exposes raw reasoning text but no verified public reasoning
  summary field. Sibyl intentionally does not display it.
- Runtime acceptance was performed with synthetic OpenCode sessions and an
  Akane schema fixture. The separately migrated Akane implementation must be
  tested with Sibyl before claiming combined integration acceptance.
- Support policy is `>=2.1.4 <3`; runtime testing in this migration is pinned
  to `2.1.4` only.
