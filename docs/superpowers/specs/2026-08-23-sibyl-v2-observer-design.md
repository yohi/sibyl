# Sibyl v2 Observer MVP Design

## Purpose

Sibyl v2 changes the plugin from a PTY-backed multi-pane console into a
read-only, real-time observer for OpenCode subagents. It lets the user keep
using the active OpenCode session while inspecting the direct child sessions
that it owns.

This MVP implements Sibyl alone. Akane health integration is a separate second
phase and is not loaded, configured, or displayed by this release.

## Scope

The observer mounts in OpenCode's `sidebar_content` slot. The host supplies a
`session_id`, which is the current parent session to observe. Sibyl tracks only
sessions whose `parentID` equals that ID. It does not recursively show
grandchild sessions.

The MVP card shows only these allowlisted fields:

- Agent name
- Provider and model, when enabled by configuration
- Normalized OpenCode runtime status
- The current tool's safe tool name and normalized state, never its title or
  payload
- Truncated, redacted latest Assistant text, when enabled by configuration
- Truncated, redacted public reasoning summary, when enabled by configuration

The normalizer must project raw OpenCode values onto this allowlist before
storing or rendering them. It must never accept raw reasoning text, raw tool
input, raw tool `raw`, output, error, title, attachments, metadata, Session
metadata, environment variables, authorization values, API keys, or other
secrets as display data. A public reasoning summary is displayable only when a
separate OpenCode field explicitly labels it public; raw `ReasoningPart.text`
is never such a field. Tool output is excluded entirely and is not inspected to
derive card content.

For each allowlisted text value, redaction is deterministic and happens before
truncation in this order:

1. Replace values of fields or assignments whose names match `authorization`,
   `password`, `secret`, `token`, `api_key`, or `apikey`, case-insensitively.
2. Replace `Basic`, `Bearer`, and equivalent authorization-scheme credentials.
3. Replace recognised API-key and access-token literals.
4. Replace sensitive environment-variable assignments, including their values.
5. Truncate the resulting text.

Every replacement uses the literal `[redacted]`; no original secret substring,
length, or encoded representation may remain. Non-text allowlisted fields are
not recursively serialized, so secrets embedded in arbitrary payloads cannot
reach the redactor or the UI.

## Architecture

```text
OpenCode state and events
          |
          v
   SubagentRegistry
   - initial snapshot
   - direct-child correlation
   - event application
   - retention cleanup
          |
          v
 SubagentRuntimeView[]
          |
          v
 SidebarObserver
          |
          v
    SubagentCard list
```

### Plugin entry point

The TUI plugin registers a `sidebar_content` slot through `api.slots.register`.
It does not register or navigate to a dedicated Sibyl route. PTY initialization,
pane split/focus/close keymaps, and route-based layout management are removed
from the observer path.

`attachSubagentIntegration` becomes the observer attachment entry point. It
receives only the resolved observer configuration and the OpenCode state/event
dependencies needed by `SubagentRegistry`; it must not receive or construct a
layout controller, `ptyManager`, `paneBackend`, attach target, server URL,
directory, or credentials. The PTY-specific
`createOpenTuiSubagentPaneManager` integration is removed from this path. The
entry point registers only `sidebar_content` and its disposal cleanup.

### `SubagentRegistry`

`SubagentRegistry` owns normalized runtime state, keyed by child session ID and
scoped by parent session ID. It accepts an initial snapshot and later OpenCode
events. UI components receive normalized views, never raw Session, Message, or
Part data.

When the sidebar receives another `session_id`, the observer selects that
parent's views. Child sessions belonging to a different parent are not shown.

`maxTrackedSubagents` independently limits the number of per-child registry
entries and is always greater than or equal to `maxVisibleSubagents`. A child
that is tracked but sorted below the visible-card limit remains in the registry
and is rendered when its priority changes or a visible card disappears.

When the tracking limit is reached, the registry first evicts the least-recent
idle child whose retention deadline has elapsed. If every entry is active, it
does not evict an active child: it applies lossy backpressure by discarding the
new child's detailed state and incrementing one bounded aggregate overflow
counter. The sidebar may show that overflow indicator but never creates an
unbounded list of omitted IDs. On deletion, idle-retention expiry, parent change,
or the next snapshot resync, capacity is reconsidered and eligible hidden or
previously omitted direct children are restored in urgency-then-recency order.

### Normalized view

Each view contains the child and parent session IDs, resolved agent and model,
runtime status, timestamps, current activity, bounded recent activity history,
latest public Assistant text, and public reasoning summary when available.

Runtime status is normalized to `busy`, `idle`, `retry`, `error`, or `unknown`.
Agent name resolution prefers AgentPart name, then Subtask agent, then
UserMessage agent. Model resolution prefers the newest AssistantMessage
provider/model and falls back to the UserMessage model selection.

## Data flow

1. Construct the registry's event sink and subscribe to Session, Message, and
   Part events before reading any snapshot. If the source supplies an event
   cursor, record it before the snapshot and reconcile events after that cursor;
   otherwise, buffer normalized events during initialization.
2. Read the available Session snapshot and retain only direct children of the
   current sidebar `session_id`, then read each tracked child's Message and Part
   data to resolve the initial view.
3. Apply the buffered or cursor-reconciled events in source order. An event for
   a child not yet present in the snapshot is retained by its `sessionID` until
   it can be correlated or is removed. Initial rendering occurs only after this
   reconciliation; subsequent events update the rendered registry directly.
4. Both in-process EventBus and SSE sources normalize these OpenCode events:

   | OpenCode event | Correlation and normalized effect |
   | --- | --- |
   | `session.created`, `session.updated` | `properties.info.id` and `properties.info.parentID`; upsert or re-scope the direct child |
   | `session.deleted` | `properties.sessionID`; remove the child and its buffered data |
   | `message.updated`, `message.removed` | `properties.sessionID` with `properties.info.id` or `properties.messageID`; refresh or remove message-derived fields |
   | `message.part.updated`, `message.part.removed` | `properties.sessionID`, `part.messageID`, and `part.id` or `properties.partID`; refresh or remove part-derived fields |
   | `session.status`, `session.idle`, `session.error` | `properties.sessionID`; normalize to runtime status and retention handling |
   | `session.next.retried` | `properties.sessionID` and `attempt`; enter `retry` until a later status, idle, error, or deletion event supersedes it |

   The event source must not reduce the observer stream to only child create,
   idle, error, and delete events. Assistant text is derived only from text
   parts correlated with an Assistant Message. Tool activity is derived only
   from tool parts correlated by `part.id`, with `callID` as fallback.
5. Identify a tool by `part.id`, with `callID` as fallback. Update the existing
   activity for `pending`, `running`, `completed`, and `error`; do not append a
   duplicate activity for a state transition.
6. Prefer a `running` tool as current activity, then a `pending` tool. Completed
   and failed tools stay only in bounded internal history for this MVP.
7. On `session.deleted`, remove the child immediately. On `idle`, retain the
   child for the configured retention period before cleanup.

## User interface

The sidebar renders a scrollable list of up to eight visible cards. Cards sort
by runtime urgency, then most recent activity:

1. `error`
2. `retry`
3. `busy`
4. `idle`
5. `unknown`

Each card uses OpenCode theme tokens rather than fixed colors. The status and
current activity are visually primary. Assistant text and reasoning summary are
secondary, truncated content. If a public reasoning summary is absent, its
section is omitted.

Example:

```text
● explore                 BUSY
  OpenAI · GPT-5.6 Terra
  ● Read src/session.ts

  Found the session lifecycle implementation.
  The next update should normalize…
  Reasoning: Correlating the latest session event…
```

## Configuration

The observer configuration is independent of Akane and of legacy PTY attach
configuration.

```ts
{
  enabled: true,
  maxVisibleSubagents: 8,
  maxTrackedSubagents: 64,
  activityLimit: 5,
  idleRetentionMs: 300_000,
  showModel: true,
  showProvider: true,
  showLatestText: true,
  showReasoningSummary: true,
}
```

Each observer option is resolved independently with this precedence:

1. Observer-specific environment variable
2. TUI plugin observer options
3. `sibyl.observer` host configuration
4. Default

The defaults are `enabled: false`, `maxVisibleSubagents: 8`,
`maxTrackedSubagents: 64`, `activityLimit: 5`, `idleRetentionMs: 300_000`, and
`true` for every display flag. `maxVisibleSubagents` accepts integers from 1
through 8; `maxTrackedSubagents` accepts integers from 8 through 256 and may not
be less than `maxVisibleSubagents`; `activityLimit` accepts integers from 1
through 20; and `idleRetentionMs` accepts integers from 0 through 3_600_000.
All display flags accept booleans only. Invalid selected values fail resolution
rather than falling through to a lower-precedence source.

The environment names are `SIBYL_OBSERVER_ENABLED`,
`SIBYL_OBSERVER_MAX_VISIBLE_SUBAGENTS`,
`SIBYL_OBSERVER_MAX_TRACKED_SUBAGENTS`, `SIBYL_OBSERVER_ACTIVITY_LIMIT`,
`SIBYL_OBSERVER_IDLE_RETENTION_MS`, `SIBYL_OBSERVER_SHOW_MODEL`,
`SIBYL_OBSERVER_SHOW_PROVIDER`, `SIBYL_OBSERVER_SHOW_LATEST_TEXT`, and
`SIBYL_OBSERVER_SHOW_REASONING_SUMMARY`.

The legacy `subagentDisplay`, `maxPanes`, server URL, directory, and PTY attach
environment settings are inspected only to emit one deprecation warning per
startup for one major version. Their values are discarded: they neither fill in
observer fields nor affect its visible count, tracking count, server connection,
directory, or PTY behavior. `subagent-integration` starts only from the fully
resolved observer configuration and performs no legacy or connection resolution.

## Failure isolation and bounds

Unknown or malformed events, missing Session/Message/Part data, and unknown
tool shapes must not crash the OpenCode TUI. The affected view displays only
the available fields and uses `unknown` where a status cannot be resolved.

The registry bounds activity history and message references, as well as child
entries through `maxTrackedSubagents`. Event bursts are coalesced by child
session and tool identity before the UI is updated. This keeps memory bounded
and supports the target of rendering an OpenCode event within 250 ms.

## Explicit exclusions

The MVP does not create PTYs, shells, `Bun.Terminal`, `node-pty`, or
`opencode attach` processes. It does not emulate a terminal, parse ANSI output,
send prompts, interrupt sessions, answer permissions or questions, change
models, or change agents. It does not integrate Akane.

## Test plan

Automated tests cover:

1. Initial snapshot rendering of one, four, and eight direct children, including
   scrollability for eight cards and events arriving while snapshot hydration is
   in progress.
2. Parent session changes in `sidebar_content`, ensuring only that parent's
   direct children appear.
3. Agent fallback, latest Assistant model precedence, model changes, and
   normalized runtime statuses, including `session.status` retry and
   `session.next.retried` transitions.
4. One tool activity transitioning from pending to running to completed or
   error without duplication.
5. Truncation and conditional rendering of public Assistant text and public
   reasoning summaries, including deterministic fixtures for authorization
   values, API keys, sensitive environment-variable assignments, and secrets
   embedded in tool output. The fixtures prove redaction occurs before
   truncation, raw reasoning and all raw tool payload fields are excluded, and
   every replacement is `[redacted]`.
6. Immediate deletion, configured idle retention, and retention expiry.
7. Missing or malformed payloads, unknown tools, and event bursts without a
   TUI crash or unbounded in-memory growth, including capacity overflow,
   backpressure, and restoration of hidden or omitted direct children after a
   resync.
8. Sidebar registration without route navigation, PTY creation, shell creation,
   or `opencode attach` execution. A regression test calls
   `attachSubagentIntegration` and proves it neither initializes a PTY manager
   nor receives PTY, pane-backend, layout, route, or attach dependencies.
9. Observer configuration precedence, defaults, validation, and display flags.
   Regression coverage proves legacy display, connection, directory, and PTY
   settings emit only a deprecation warning and cannot alter observer behavior.

## Deferred phase

Akane integration begins only after Akane publishes a versioned, compatible
public integration API. That phase adds an optional health adapter to enrich
the existing runtime view; it does not move watchdog or recovery behavior into
Sibyl.
