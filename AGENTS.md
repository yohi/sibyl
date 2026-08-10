# AGENTS.md — Sibyl

Sibyl is an OpenCode multi-pane integrated console plugin that replaces Tmux with OpenTUI + PTY for dynamic pane splitting and process control inside a single terminal.

## Stack

- **Bun** is the package manager and test runner (never npm/pnpm/yarn).
- TypeScript (strict), Solid.js + OpenTUI, Rollup + tsc build, Biome lint/format.
- PTY: Bun built-in `Bun.Terminal` on POSIX; `node-pty` optional elsewhere.

## Verify before finishing any change

```bash
bun run lint
bun run typecheck
bun run test
```

## Working rules

See [docs/WORKING_RULES.md](./docs/WORKING_RULES.md) for the full conventions. The short version: let Biome enforce style, never suppress type errors, cover behavior changes with tests, guarantee PTY cleanup, and use Japanese Conventional Commits.

## Read-Map (progressive disclosure)

- `SPEC.md` — formal spec and current source of truth: keymaps, PTY lifecycle, cleanup ownership, acceptance criteria, roadmap.
- `REQUIREMENTS.md` — original requirements and rationale.
- `docs/architecture.md` — component structure and known limitations (e.g., per-pane PTY sizing).
- `docs/WORKING_RULES.md` — coding, testing, and Git conventions.
- `CHANGELOG.md` — release history; check before assuming a behavior is a bug.
