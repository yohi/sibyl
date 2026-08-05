# Sibyl Negative-Gap Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the four negative gaps identified between the design/plan documents and the current Sibyl implementation: (1) clarify the Server `/sibyl` command contract so its delegation to the TUI host is explicit and tested, (2) make the last-pane-close behavior recoverable, (3) add a performance acceptance test for PTY-to-render latency, and (4) document the per-pane dimension limitation.

**Architecture:** Keep the TUI route/keymap path as the single entry point for opening Sibyl. The Server plugin remains a thin command registrar; tests and comments will make the "host navigates" contract explicit. For the last-pane-close edge case, auto-spawn a new default shell pane so the layout never becomes an empty/unfocusable tree. Add a statistical render-latency test that exercises 1000 samples at ~100 Hz. Record the per-pane dimension limitation in code comments and architecture docs.

**Tech Stack:** SolidJS / TypeScript / OpenTUI / Bun test runner. No new dependencies.

## Global Constraints

- No `as any`, `@ts-ignore`, or `@ts-expect-error`.
- No absolute paths in committed files.
- No new AI agent config files.
- Follow existing code style in `src/layout-manager.tsx`, `src/keymap.ts`, `src/pane.tsx`, and tests.
- All behavior changes must be covered by tests.
- Commits follow Conventional Commits in Japanese (per project context).

---

## Task 1: Clarify and test the Server `/sibyl` command delegation contract

**Files:**
- Modify: `src/server.ts:11-14`
- Modify: `tests/server.test.ts`
- Modify: `README.md:21-40` (if the opening instructions are ambiguous)

**Interfaces:**
- Consumes: `Plugin`/`PluginModule` types from `@opencode-ai/plugin`.
- Produces: A stronger test asserting that `command.execute.before` leaves `output` unchanged for `sibyl` and still sets `config.command.sibyl`.

- [ ] **Step 1: Write the failing test**

In `tests/server.test.ts`, add:

```ts
  test("delegates sibyl command handling to the host without mutating output", async () => {
    const hooks = await Reflect.apply(plugin.server, undefined, [undefined]);
    const output = { parts: [] };

    await hooks["command.execute.before"]?.(
      { command: "sibyl", sessionID: "session", arguments: "" },
      output,
    );

    expect(output).toEqual({ parts: [] });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/server.test.ts`
Expected: The new test FAILS if the current implementation would mutate output; otherwise it should pass as-is.

- [ ] **Step 3: Replace vague comment in `src/server.ts`**

Change `src/server.ts:11-14` from:

```ts
  "command.execute.before": async (input) => {
    if (input.command !== "sibyl") return;
    // Navigation is handled by the host.
  },
```

to:

```ts
  "command.execute.before": async (input) => {
    if (input.command !== "sibyl") return;
    // Intentionally no-op: the TUI plugin registers `sibyl.open` and the
    // host navigates to the Sibyl route. This hook only prevents other
    // plugins from treating `/sibyl` as an unknown command.
  },
```

- [ ] **Step 4: Run full server tests**

Run: `bun test tests/server.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/server.test.ts
git commit -m "docs(test): Server sibylコマンドがTUI routeへ委譲されることを明示・テスト"
```

---

## Task 2: Make last-pane-close recoverable by auto-spawning a replacement pane

**Files:**
- Modify: `src/keymap.ts`
- Modify: `src/layout-manager.tsx`
- Modify: `tests/layout-manager.test.tsx`
- Modify: `tests/keymap.test.ts`

**Interfaces:**
- Consumes: `PaneModel`, `PtyOptions`, `SplitDirection`, and `createLayoutManagerController`.
- Produces: A `LayoutManagerController` whose `closePane` guarantees at least one leaf remains; if the root becomes empty, a new default shell pane is inserted and focused.

- [ ] **Step 1: Write the failing test**

Add to `tests/layout-manager.test.tsx`:

```ts
  test("replaces the root with a new default shell pane when the last pane closes", async () => {
    const terminate = mock(async (_id: string) => {});
    const layout = createLayoutManagerController(
      { terminate },
      { id: "pane-a", ptyOptions: { command: "sh", args: [] } },
    );

    await layout.closePane("pane-a");

    const root = layout.model();
    expect(root.children).toBeUndefined();
    expect(root.id).not.toBe("pane-a");
    expect(root.ptyOptions).toBeDefined();
    expect(layout.focusedId()).toBe(root.id);
    expect(terminate).toHaveBeenCalledTimes(1);
  });
```

Add to `tests/keymap.test.ts` a similar test for `closePaneInTree` returning a fresh leaf when closing the only leaf.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/layout-manager.test.tsx tests/keymap.test.ts`
Expected: FAIL — after closing the last pane, the model is empty and focusedId is undefined.

- [ ] **Step 3: Implement replacement-pane logic**

In `src/keymap.ts`, introduce a helper:

```ts
export function createDefaultShellPane(options?: { id?: string }): PaneModel {
  return {
    id: options?.id ?? "pane-0",
    ptyOptions: {
      command: process.platform === "win32" ? "cmd.exe" : process.env.SHELL || "sh",
      args: [],
    },
  };
}
```

Update `closePane` so that when the result is `undefined` (the last leaf was removed), it returns `createDefaultShellPane({ id: nextUniqueId(...) })` instead.

In `src/layout-manager.tsx`, update `closePane` (around lines 125-143) so that when the returned tree is a fresh leaf (detect by checking whether the root still has children or is the same id), it:
1. Terminates the old pane.
2. Resets `ptyHandleByPane` for the new pane.
3. Sets `focusedId` to the new pane id.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/layout-manager.test.tsx tests/keymap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/keymap.ts src/layout-manager.tsx tests/layout-manager.test.tsx tests/keymap.test.ts
git commit -m "feat: 最後のペインclose後に既定shellペインを自動生成して復旧可能にする"
```

---

## Task 3: Add a statistical render-latency acceptance test

**Files:**
- Create: `tests/pty-render-latency.test.ts`
- Modify: `tests/pane-render.integration.tsx` (only to add a clarifying comment, no logic change)

**Interfaces:**
- Consumes: `Pane`, `PaneSpawner`, `testRender` from `@opentui/solid`.
- Produces: A test that emits 1000 lines at ~100 Hz and measures the time from `onData` fire to frame capture.

- [ ] **Step 1: Write the latency test**

Create `tests/pty-render-latency.test.ts`:

```ts
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { Pane } from "../src/pane";
import type { PaneSpawner } from "../src/pane-backend";

test(
  "renders 1000 PTY output samples with p95 <= 50ms and p99 <= 100ms",
  async () => {
    let emitData: ((data: string) => void) | undefined;
    const ptyManager = {
      spawn: async () => ({
        id: "pty-latency",
        write: () => {},
        resize: () => {},
        onData: (listener: (data: string) => void) => {
          emitData = listener;
          return () => {
            emitData = undefined;
          };
        },
        onExit: () => () => {},
      }),
    } satisfies PaneSpawner;

    const view = await testRender(
      () => (
        <Pane
          model={{ id: "pane-latency", ptyOptions: { command: "fake-shell", args: [] } }}
          ptyManager={ptyManager}
          focused={false}
          onFocus={() => {}}
          onPtyReady={async () => {}}
        />
      ),
      { width: 80, height: 24 },
    );

    try {
      await view.renderOnce();
      await view.flush();
      if (emitData === undefined) throw new Error("Pane did not subscribe to PTY output");

      const samples: number[] = [];
      const targetHz = 100;
      const intervalMs = 1000 / targetHz;
      const totalSamples = 1000;

      for (let i = 0; i < totalSamples; i++) {
        const payload = `sample-${i}\n`;
        const start = performance.now();
        emitData(payload);
        await view.renderOnce();
        const frame = view.captureCharFrame();
        const end = performance.now();
        if (frame.includes(`sample-${i}`)) {
          samples.push(end - start);
        } else {
          throw new Error(`sample-${i} did not appear in captured frame`);
        }
        if (i < totalSamples - 1) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      }

      samples.sort((a, b) => a - b);
      const p95 = samples[Math.floor(samples.length * 0.95)];
      const p99 = samples[Math.floor(samples.length * 0.99)];

      expect(samples.length).toBeGreaterThanOrEqual(totalSamples * 0.95);
      expect(p95).toBeLessThanOrEqual(50);
      expect(p99).toBeLessThanOrEqual(100);
    } finally {
      view.renderer.destroy();
    }
  },
  60_000,
);
```

- [ ] **Step 2: Add a clarifying comment to the existing integration test**

In `tests/pane-render.integration.tsx`, before the `emitData` line, add:

```ts
    // This test verifies the PTY output reaches the OpenTUI render tree within
    // the next frame. The separate pty-render-latency.test.ts exercises the
    // 1000-sample statistical requirement (p95 <= 50ms, p99 <= 100ms).
```

- [ ] **Step 3: Run the latency test and verify it passes or tune**

Run: `bun test tests/pty-render-latency.test.ts`
Expected: PASS. If p95/p99 are too high in the fake-pty test renderer environment, document the measured values in the test comment and relax the assertion only if the plan owner approves.

- [ ] **Step 4: Run the full test suite**

Run: `bun run test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/pty-render-latency.test.ts tests/pane-render.integration.tsx
git commit -m "test: PTY出力の描画レイテンシ受入試験を追加"
```

---

## Task 4: Document the per-pane dimension limitation

**Files:**
- Modify: `src/pane.tsx:50-64`
- Modify: `docs/architecture.md:12-16`
- Modify: `docs/plans/2026-07-28-opentui-pty-plugin-plan.md:21` area

**Interfaces:**
- No new code interfaces. Produces updated comments and docs.

- [ ] **Step 1: Update the comment in `src/pane.tsx`**

Change the existing comment in `src/pane.tsx:50-54` to:

```ts
  createEffect(() => {
    // OpenTUI Solid currently exposes only the full terminal dimensions via
    // useTerminalDimensions(). The design roadmap calls for per-pane sizing
    // (flex-basis / Yoga layout), but until an API is available each Pane
    // receives the terminal-wide cols/rows. This satisfies the plan's
    // "terminal dimensions -> PTY size" sync requirement with the documented
    // limitation that split panes share the same size temporarily.
    const { width, height } = terminalDimensions();
```

- [ ] **Step 2: Update `docs/architecture.md`**

Append after line 16:

```md
## Current Limitations

- **Per-pane PTY dimensions**: Each `Pane` currently resizes its PTY to the
  full terminal dimensions because OpenTUI Solid does not yet expose a
  per-renderable size API. Split panes therefore receive identical `cols` and
  `rows`. The plan's dimension sync requirement is met at the terminal level;
  per-pane sizing will follow once the underlying framework API is available.
```

- [ ] **Step 3: Update `docs/plans/2026-07-28-opentui-pty-plugin-plan.md`**

Find the `useTerminalDimensions` task area and add a note:

```md
> **Note:** As of the current milestone, `useTerminalDimensions()` returns the
> full terminal size; per-pane dimensions require a future OpenTUI API. The
> implementation resizes each PTY to the terminal dimensions and documents this
> limitation in `docs/architecture.md`.
```

- [ ] **Step 4: Commit**

```bash
git add src/pane.tsx docs/architecture.md docs/plans/2026-07-28-opentui-pty-plugin-plan.md
git commit -m "docs: ペイン単位サイズAPI未提供の制限をコードコメントと設計書に明記"
```

---

## Task 5: Full verification and final commit

**Files:**
- Entire project.

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 2: Run build**

Run: `bun run build`
Expected: `dist/index.js`, `dist/server.js`, `dist/tui.js` created successfully.

- [ ] **Step 3: Run linter**

Run: `bun run lint`
Expected: No errors or warnings.

- [ ] **Step 4: Run full test suite**

Run: `bun run test`
Expected: All tests pass, including new latency and last-pane-close tests.

- [ ] **Step 5: Commit if any final fixes were required**

If Step 1-4 required any changes, commit them; otherwise no commit needed.

```bash
git commit -m "chore: 全テスト・ビルド・リントを確認"
```

---

## Self-Review

1. **Spec coverage:**
   - Server command contract → Task 1
   - Last-pane-close recovery → Task 2
   - Performance acceptance test → Task 3
   - Per-pane dimension limitation documented → Task 4
   - Full verification → Task 5
2. **Placeholder scan:** No placeholders or TODOs remain.
3. **Type consistency:** `createDefaultShellPane` returns `PaneModel`, compatible with `closePane` and `LayoutManagerController`.
