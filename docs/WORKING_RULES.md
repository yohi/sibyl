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
- Run `bun run test` and ensure all tests pass before considering a change complete.

## PTY Lifecycle

- Every spawned PTY must have a guaranteed cleanup path.
- Use `PtyTerminator` / `PtyManager` and wire disposal through OpenCode `onDispose` hooks.

## Git Workflow

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) in Japanese.
- Do not commit, push, or merge pull requests unless explicitly instructed.
