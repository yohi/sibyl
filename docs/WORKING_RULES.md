# Working Rules — Sibyl

This document expands on the non-negotiable conventions referenced from [AGENTS.md](../AGENTS.md). Read it when you are about to write, refactor, or submit code.

## Type Safety

- Never suppress type errors: no `as any`, `@ts-ignore`, or `@ts-expect-error`.
- TypeScript is configured to `strict`; treat every diagnostic as blocking.

## Style and Formatting

- Let Biome enforce style. Do not reformat code by hand.
- Follow existing module patterns and naming conventions in the surrounding code.

## Testing

- Any behavior change must be covered by tests in `tests/`.
- Run `bun run lint`, `bun run typecheck`, and `bun run test`, and ensure all checks pass before considering a change complete.

## Cleanup Ownership

- The Observer owns no processes. Registry stop must abort reads and refreshes, clear retention timers, unsubscribe handlers, and stop the event source idempotently.
- Inside the legacy generic PTY modules, every spawned PTY keeps a guaranteed cleanup path through `PtyTerminator` / `PtyManager`.
- Wire disposal through OpenCode `onDispose` hooks.

## Git Workflow

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) in Japanese.
- Do not commit, push, or merge pull requests unless explicitly instructed.
