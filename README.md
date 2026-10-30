# Sibyl

Sibyl is a read-only OpenCode V2 TUI plugin for viewing Akane watchdog status
and the current session's direct child sessions.

## Requirements

- OpenCode `2.1.4` or newer in the V2 major line (`>=2.1.4 <3`).
- An Akane V2 server plugin that writes the versioned
  `.akane/watchdog-state.json` file.
- Bun for local development and tests.

The `master` branch retains the OpenCode V1 implementation. This branch targets
V2 and does not provide V1 adapters. The current candidate is
`@yohi/sibyl@3.0.0-alpha.1`.

## Install

Register the Akane server plugin in `opencode.json`:

```json
{
  "plugin": ["@yohi/akane"]
}
```

Register Sibyl's TUI plugin in the terminal configuration at
`$XDG_CONFIG_HOME/opencode/cli.json` (normally
`~/.config/opencode/cli.json`):

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["@yohi/sibyl"]
}
```

The V2 TUI loader resolves the `./tui` package export. Remove the old
`@yohi/akane/tui` entry and restart OpenCode.

## Configure

Observer options belong to Sibyl's plugin entry, not a top-level `sibyl` host
configuration block. The Observer is disabled by default:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    {
      "package": "@yohi/sibyl",
      "options": {
        "observer": {
          "enabled": true,
          "maxVisibleSubagents": 8,
          "maxTrackedSubagents": 64,
          "activityLimit": 5,
          "idleRetentionMs": 300000,
          "showModel": true,
          "showProvider": true,
          "showLatestText": true,
          "showReasoningSummary": true
        }
      }
    }
  ]
}
```

Each setting can be overridden with its `SIBYL_OBSERVER_*` environment
variable. Precedence is:

```text
environment > plugin options > defaults
```

An invalid selected value rejects plugin setup rather than falling through.
See [SPEC.md](SPEC.md) for defaults, ranges, and the complete safety contract.

| Option | Environment variable |
| --- | --- |
| `enabled` | `SIBYL_OBSERVER_ENABLED` |
| `maxVisibleSubagents` | `SIBYL_OBSERVER_MAX_VISIBLE_SUBAGENTS` |
| `maxTrackedSubagents` | `SIBYL_OBSERVER_MAX_TRACKED_SUBAGENTS` |
| `activityLimit` | `SIBYL_OBSERVER_ACTIVITY_LIMIT` |
| `idleRetentionMs` | `SIBYL_OBSERVER_IDLE_RETENTION_MS` |
| `showModel` | `SIBYL_OBSERVER_SHOW_MODEL` |
| `showProvider` | `SIBYL_OBSERVER_SHOW_PROVIDER` |
| `showLatestText` | `SIBYL_OBSERVER_SHOW_LATEST_TEXT` |
| `showReasoningSummary` | `SIBYL_OBSERVER_SHOW_REASONING_SUMMARY` |

## Privacy and scope

Sibyl reads public V2 session/message/event data, the selected session's Akane
state, and optional safe category labels from existing task/team runtime
records. It displays only the current session's direct children. It does not
create or mutate sessions, send prompts, change permissions or models, start
processes, or register routes/keymaps.

Text is redacted before truncation. Tool inputs, outputs, errors, metadata,
attachments, credentials, and raw reasoning are never retained or rendered.
OpenCode `2.1.4` has no verified public reasoning-summary field, so
`showReasoningSummary` is accepted but no reasoning content is displayed.
If Akane state is missing, disabled, malformed, or stale, the sidebar is
hidden.

## Development

```bash
bun install
bun run lint
bun run typecheck
bun run test
bun run build
```

See [architecture](docs/architecture.md), [migration evidence](docs/migration.md),
and [CHANGELOG](CHANGELOG.md).
