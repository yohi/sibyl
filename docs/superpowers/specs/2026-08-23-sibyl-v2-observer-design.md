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

The MVP card shows:

- Agent name
- Provider and model
- OpenCode runtime status
- Current running or pending tool
- Truncated, public latest Assistant text
- Public reasoning summary when OpenCode exposes one

Sibyl does not show hidden chain-of-thought, raw tool input or output,
environment variables, authorization values, API keys, or other secrets.

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

### `SubagentRegistry`

`SubagentRegistry` owns normalized runtime state, keyed by child session ID and
scoped by parent session ID. It accepts an initial snapshot and later OpenCode
events. UI components receive normalized views, never raw Session, Message, or
Part data.

When the sidebar receives another `session_id`, the observer selects that
parent's views. Child sessions belonging to a different parent are not shown.

### Normalized view

Each view contains the child and parent session IDs, resolved agent and model,
runtime status, timestamps, current activity, bounded recent activity history,
latest public Assistant text, and public reasoning summary when available.

Runtime status is normalized to `busy`, `idle`, `retry`, `error`, or `unknown`.
Agent name resolution prefers AgentPart name, then Subtask agent, then
UserMessage agent. Model resolution prefers the newest AssistantMessage
provider/model and falls back to the UserMessage model selection.

## Data flow

1. On observer initialization, read the available Session snapshot and retain
   only direct children of the current sidebar `session_id`.
2. Read each tracked child's Message and Part data to resolve the initial view.
3. Subscribe to Session, Message, and Part events. Apply each event only to its
   associated child view, then re-normalize that view.
4. Identify a tool by `part.id`, with `callID` as fallback. Update the existing
   activity for `pending`, `running`, `completed`, and `error`; do not append a
   duplicate activity for a state transition.
5. Prefer a `running` tool as current activity, then a `pending` tool. Completed
   and failed tools stay only in bounded internal history for this MVP.
6. On `session.deleted`, remove the child immediately. On `idle`, retain the
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
  activityLimit: 5,
  idleRetentionMs: 300_000,
  showModel: true,
  showProvider: true,
  showLatestText: true,
  showReasoningSummary: true,
}
```

`maxVisibleSubagents` accepts values from 1 through 8. `activityLimit` accepts
values from 1 through 20. The legacy `subagentDisplay`, `maxPanes`, server URL,
directory, and PTY attach environment settings remain readable for one major
version only to emit a deprecation warning; they do not configure the observer.

## Failure isolation and bounds

Unknown or malformed events, missing Session/Message/Part data, and unknown
tool shapes must not crash the OpenCode TUI. The affected view displays only
the available fields and uses `unknown` where a status cannot be resolved.

The registry bounds activity history and message references. Event bursts are
coalesced by child session and tool identity before the UI is updated. This
keeps memory bounded and supports the target of rendering an OpenCode event
within 250 ms.

## Explicit exclusions

The MVP does not create PTYs, shells, `Bun.Terminal`, `node-pty`, or
`opencode attach` processes. It does not emulate a terminal, parse ANSI output,
send prompts, interrupt sessions, answer permissions or questions, change
models, or change agents. It does not integrate Akane.

## Test plan

Automated tests cover:

1. Initial snapshot rendering of one, four, and eight direct children, including
   scrollability for eight cards.
2. Parent session changes in `sidebar_content`, ensuring only that parent's
   direct children appear.
3. Agent fallback, latest Assistant model precedence, model changes, and
   normalized runtime statuses.
4. One tool activity transitioning from pending to running to completed or
   error without duplication.
5. Truncation and conditional rendering of public Assistant text and public
   reasoning summaries.
6. Immediate deletion, configured idle retention, and retention expiry.
7. Missing or malformed payloads, unknown tools, and event bursts without a
   TUI crash or unbounded in-memory growth.
8. Sidebar registration without route navigation, PTY creation, shell creation,
   or `opencode attach` execution.
9. Redaction of secret-like content from displayed tool and Assistant fields.

## Deferred phase

Akane integration begins only after Akane publishes a versioned, compatible
public integration API. That phase adds an optional health adapter to enrich
the existing runtime view; it does not move watchdog or recovery behavior into
Sibyl.
