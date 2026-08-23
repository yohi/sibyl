# AGENTS.md — Sibyl

Sibyl gives operators a read-only, secret-safe overview of the active OpenCode
session's direct child agent sessions inside the `sidebar_content` slot. It does
not create sessions, send prompts, manage models, register routes or keymaps, or
spawn PTYs, shells, or attach processes.

## Stack

- **Bun** is the package manager and test runner (do not use npm/pnpm/yarn).
- TypeScript (strict), Solid.js + OpenTUI, Rollup + tsc build, Biome lint/format.
- Generic PTY modules remain exported for public-API compatibility; the Observer
  path never imports or constructs them.

## Verify before finishing any change

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

## Progressive disclosure

This file stays small. Start with the most relevant doc below; detailed
conventions and implementation rules live in those files, not here.

- `SPEC.md` — observer contract: configuration, safety projection, redaction,
  event handling, registry bounds, cleanup, acceptance criteria.
- `docs/architecture.md` — data flow, component responsibilities,
  bounded-state contract, current limitations.
- `docs/WORKING_RULES.md` — coding, testing, cleanup, and Git conventions.
- `CHANGELOG.md` — release history and migration context.

Let Biome enforce style and formatting. Do not ask the agent to act as a linter.
