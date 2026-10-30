# Sibyl V2 Observer Specification

This document is the normative product contract for the OpenCode V2 TUI
plugin. It targets OpenCode `>=2.1.4 <3`; development and runtime acceptance
must use the exact `2.1.4` release. The `master` branch retains the V1
implementation. This branch contains no V1 compatibility adapter.

## 1. Purpose and boundaries

Sibyl displays the Akane watchdog state and direct child sessions of the
currently selected parent session. It is read-only and must not:

- create, edit, delete, resume, or prompt sessions;
- change permissions, agent selection, model selection, providers, or MCP;
- register routes or keymaps, spawn PTYs/processes, or open an independent
  network connection;
- read credentials, raw tool payloads, raw reasoning, attachments, or arbitrary
  SDK metadata into retained state.

The V2 path uses public `@opencode/plugin/tui` and `@opencode/client` APIs only.
Generic legacy PTY library exports are not instantiated by the Observer.

## 2. Runtime and packaging contract

- The V2 plugin is `Plugin.define({ id: "oh-my-opencode.sibyl", setup })` from
  `@opencode/plugin/tui`.
- The package root exposes framework-independent Observer/core APIs; `./tui`
  exposes the V2 terminal plugin definition.
- Peer support policy is OpenCode `>=2.1.4 <3`; build/test artifacts pin
  `@opencode/plugin` and `@opencode/client` to `2.1.4`.
- TUI rendering dependencies are peers and Rollup externals. A published build
  must not bundle host OpenTUI, Solid, Effect, or a second plugin runtime.
- V2 TUI configuration is `cli.json`, including `plugins` entries. The plugin
  loader resolves the package's `./tui` export. Local plugin targets are
  directories containing the `tui` entry, not individual TypeScript files.

## 3. Configuration

The plugin accepts `options.observer`. The nine fields and defaults are:

| Field | Default | Accepted values |
| --- | ---: | --- |
| `enabled` | `false` | boolean |
| `maxVisibleSubagents` | `8` | integer 1–8 |
| `maxTrackedSubagents` | `64` | integer 8–256 and at least visible count |
| `activityLimit` | `5` | integer 1–20 |
| `idleRetentionMs` | `300000` | integer 0–3600000 |
| `showModel` | `true` | boolean |
| `showProvider` | `true` | boolean |
| `showLatestText` | `true` | boolean |
| `showReasoningSummary` | `true` | boolean |

Each field is resolved independently in this order:

```text
SIBYL_OBSERVER_* environment variable > plugin options > default
```

Environment booleans are `true`, `false`, `1`, or `0`; integers are unsigned
base-10 values within the table's range. An invalid selected value rejects
setup without falling back. V1 `sibyl.observer`, `SIBYL_SUBAGENT_*`, and legacy
connection values are not read or migrated.

## 4. State and data flow

```text
Plugin.define setup
  -> validated V2 options
  -> sidebar.content slot claim
  -> resolve current session and its V2 Location
  -> Akane state gate
  -> V2 events + bounded session snapshot
  -> safe projection -> parent-scoped SubagentRegistry -> cards
```

The slot claim is additive: `ui.slot({ append: "sidebar.content", render })`.
The slot's `sessionID` is the parent identity. A session is eligible only when
its V2 `parentID` exactly matches that ID. Grandchildren are not recursively
included.

Resolve location using `client.session.get({ sessionID })`, verify the returned
session ID, then resolve its public `session.location` with
`client.location.get` and verify that the returned directory matches the
session's selected directory. Never substitute process cwd, plugin cwd, or a default
location for a missing session location. Location-specific Akane and optional
display metadata are read only after identity/location verification.

### 4.1 Snapshot limits

- Enumerate children via V2 `client.session.list` filtered by `parentID` and
  follow cursors. Detect repeated cursors and cap the traversal at 4096 cursors.
- Select no more than `maxTrackedSubagents`, ordered by urgency, update time,
  then safe session ID. Keep only top-K candidate state while paging.
- Hydrate selected sessions with at most 8 concurrent reads, 32 newest
  messages per child, and 64 projected parts per child.
- Honor AbortSignal and reject stale results after cancellation, parent switch,
  child deletion, or plugin cleanup.
- A response for a different requested session/message ID is discarded.

The snapshot's `omittedCount` reports eligible direct children excluded by
tracking capacity. It excludes wrong-parent and tombstoned children.

## 5. Safe projection and privacy

Only safe identifiers, timestamps, normalized status, redacted assistant text,
and allowlisted tool names/states may enter the Registry. The Session
projection retains its ID, parent ID, creation/update timestamps, and an
optional category derived only from a leading `[safe-category]` title prefix;
the title itself is discarded. Project Session and Message records from V2
public schemas. Session/message ownership is supplied from the verified
request rather than trusted from provider/native payloads.

Text is redacted before truncation. The literal replacement is `[redacted]`.
Maximum lengths are 160 characters for assistant text and 64 for display
identifiers/tool names; correlation IDs retain the existing 128-character
limit. Invalid IDs/messages are dropped; invalid tool labels become `unknown`.

For V2 assistant content, text is redacted; tool entries retain only ID, safe
name, normalized status, and timestamp. `streaming` maps to `pending`. Preserve
the newest text and active running/pending tools within the 64-part bound.
Exclude tool input, result content, errors, metadata, native provider records,
and raw reasoning. V2 `2.1.4` provides no verified public reasoning-summary
field; `showReasoningSummary` remains a valid option but no reasoning is shown.

Model and provider labels are derived only from safe V2 model references.
Agent label precedence is verified safe agent-part data if present, subtask
agent if present, latest V2 assistant agent, then `unknown`.

## 6. Events, status, and reconciliation

Subscribe once through `context.data.listen`; consume each event's tagged
`details.type` and `details.data` envelope. Normalize V2 session lifecycle,
status, execution, retry, step, text, and tool events. Text/tool/step changes
request authoritative message refresh using `assistantMessageID`; event text
deltas and tool input are never retained. Session creation/move/fork/delete and
revert changes request a resync as appropriate. `session.idle` is not treated as
an exactly-once completion boundary. Unknown/malformed events are ignored.

On selection, subscribe before the initial snapshot, buffer bounded events,
apply the snapshot, then replay ordered events. During resync, use a sequence
watermark and replay only newer events. Duplicate, reordered, and stale events
must not duplicate cards or resurrect deleted sessions.

When Akane state is available and a parent is selected, request immediate
reconciliation and poll every 5000 ms. Coalesce concurrent refreshes into at
most one running request and one dirty follow-up. Deactivate the poll while the
Akane gate is unavailable. A successful idle outcome is authoritative over
older failed messages; an assistant message newer than the session idle
watermark leaves status `unknown` until reconciled. An error in an old message
must not override a newer successful idle status.

## 7. Bounded Registry and display

`maxTrackedSubagents` bounds detailed child entries. `maxVisibleSubagents`
limits rendered cards without deleting lower-ranked tracked entries. Per-child
messages, parts, activity history, pending events, refresh keys, omitted IDs,
and tombstones are bounded. Overflow is a saturating aggregate indicator, not
an unbounded omitted-ID list.

At capacity, evict only `idle` entries whose retention deadlines expired. Do
not evict busy/retry/error/unknown entries or idle entries still in retention.
If no safe eviction exists, omit new child details and report overflow. A
successful snapshot may reselect candidates by urgency, update time, and ID.

Cards are ordered `error > retry > busy > idle > unknown`, then most recently
updated first. Current activity selects `running` before `pending`; only
completed/error tools appear in `activityLimit` history. Optional colors or
category decorations may be absent without affecting the Observer.

## 8. Akane contract

Read `.akane/watchdog-state.json` from the selected session's resolved
location and verified project directory. Accept only schema version `1`,
`enabled: true`, timestamp no more than 90000 ms old and no more than 30000 ms
in the future. Missing, malformed, disabled, stale, or unsupported state hides
both watchdog and child-session UI and pauses reconciliation. Refresh state
every second; recovery makes the UI eligible again. Akane owns monitoring and
recovery. A fixture is not evidence of interoperability with Akane V2.

## 9. Lifecycle and failure behavior

Setup validates options before allocating host resources. Plugin setup returns
an idempotent asynchronous cleanup. The plugin owns its slot disposer and all
mounted component cleanups. Each component owns its event unsubscribe, abort
controller, and timers. Repeated cleanup is safe; cleanup continues even if
one resource disposal fails. No callback may update the Registry after stop.

Malformed data is ignored. Recoverable reads log only sanitized operation
categories and may be retried by later reconciliation. No raw SDK payload or
error text is logged.

## 10. Acceptance

- `bun run lint`, `bun run typecheck`, `bun run test`, and `bun run build` pass.
- Unit tests cover config, safe projection/redaction, V2 event envelopes,
  pagination/capacity, location/session identity, cancellation, Registry races,
  reconciliation, and idempotent cleanup.
- Rendering tests cover Akane visibility, child cards, theme, category, and
  absence of sensitive content.
- An isolated OpenCode `2.1.4` host loads the built package and displays the
  additive sidebar, synthetic direct child, activity changes, and unload.
- Akane interoperability is a separate gate; report it not-run/blocked when the
  migrated Akane package is unavailable. Never infer host compatibility from
  typecheck or a synthetic state fixture.
