# AGENTS.md — Sibyl

## Project (WHAT / WHY)

Sibyl is an OpenCode multi-pane integrated console plugin. It manages parallel
agent processes with dynamic pane splitting and PTY control inside a single
terminal — without Tmux. Goal: remove Tmux dependency (portability, zombie
sessions, render lag) by using OpenTUI (Solid.js/Yoga) + PTY.

Implemented as an OpenCode plugin: `@opencode-ai/plugin` (server) and
`@opencode-ai/plugin/tui` (TUI).

## Stack (HOW)

- **Bun** is the package manager and test runner. Do not use npm/pnpm/yarn.
- TypeScript (strict), Solid.js + OpenTUI, Rollup + tsc build, Biome lint/format.
- PTY: Bun built-in `Bun.Terminal` on POSIX; `node-pty` (optionalDependency) elsewhere.

## Commands

- `bun install`
- `bun run build` — tsc declarations + Rollup bundle
- `bun run test` — unit tests + OpenTUI integration (`--conditions=browser`)
- `bun run lint` and `bun run typecheck` — run both before finishing any change

## Working Rules

- Never suppress type errors: no `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Let Biome enforce style; do not reformat code by hand. Follow existing module patterns.
- Any behavior change must be covered by tests in `tests/`.
- Every spawned PTY must have a guaranteed cleanup path (see `PtyTerminator`/`PtyManager`).
- Commits: Conventional Commits in Japanese.
- Do not commit/push or merge PRs unless explicitly instructed.

## Read-Map (progressive disclosure — read only what the task needs)

- `SPEC.md` — formal spec and current source of truth: keymaps, PTY lifecycle, cleanup ownership,
  acceptance criteria (performance, multi-platform), roadmap.
- `REQUIREMENTS.md` — original requirements and rationale; background and design intent
  behind the acceptance criteria.
- `docs/architecture.md` — component structure and known limitations
  (e.g., per-pane PTY sizing).
- `CHANGELOG.md` — release history; check before assuming a behavior is a bug.
- `docs/superpowers/plans/` — historical remediation plans; verify their
  status before acting on them.
- `src/server.ts` is a thin command registrar; `src/tui.tsx` owns routes,
  keymaps, and dispose; `src/pty-*.ts` owns the PTY lifecycle. See the
  component table in SPEC.md for the full map.
