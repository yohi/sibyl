# Preserve PTY Session on Layout Change

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop unnecessary PTY respawn when `split` and `close` layout operations cause a surviving pane to remount.

**Architecture:**
Move PTY handle ownership from individual `Pane` components up to `LayoutManager` so that a pane id keeps the same `PtyHandle` across remounts. `Pane` will receive an optional `initialPtyHandle` for its `model.id`; if present it reuses it, otherwise it spawns. `LayoutManager` maintains a `Map<PaneId, PtyHandle>` and only removes an entry when the pane is explicitly closed.

**Tech Stack:**
SolidJS / TypeScript / OpenTUI / Bun test runner.

## Global Constraints

- No `as any`, `@ts-ignore`, or `@ts-expect-error`.
- No absolute paths in committed files.
- No new AI agent config files.
- Follow existing code style in `src/layout-manager.tsx` and `src/pane.tsx`.
- All behavior changes must be covered by tests.
- Commits follow Conventional Commits in Japanese (per project context).

---

## Task 1: Make `Pane` reusable across mounts with an optional initial PTY handle

**Files:**
- Modify: `src/pane.tsx`
- Modify: `src/types.ts`
- Test: `tests/pane.test.tsx` (create if it does not exist; otherwise add to existing)

**Interfaces:**
- Consumes:
  - `PaneModel` with `id`, `ptyOptions`.
  - New optional prop `initialPtyHandle?: PtyHandle`.
- Produces:
  - `Pane` that reuses `initialPtyHandle` when provided instead of spawning.
  - `Pane` still calls `onPtyReady` and sets up data/exit listeners on the reused handle.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, jest, test } from "bun:test";
import { Pane } from "../src/pane";

describe("Pane", () => {
  test("reuses an initial PTY handle instead of spawning", async () => {
    const onPtyReady = jest.fn(async () => {});
    const initialHandle = {
      id: "pty-1",
      write: () => {},
      resize: () => {},
      onData: () => () => {},
      onExit: () => () => {},
    };

    // Render Pane with initial handle
    // After mount, expect onPtyReady to be called with the initial handle id
    // and expect ptyManager.spawn NOT to be called
  });
});
```

> Worker note: use `@opentui/solid` `testRender` to render `<Pane model={{ id: "pane-1", ptyOptions: { command: "bash", args: [] } }} ... />`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/pane.test.tsx`
Expected: FAIL because `Pane` always spawns and ignores `initialPtyHandle`.

- [ ] **Step 3: Write minimal implementation**

In `src/pane.tsx`:
1. Add `initialPtyHandle?: PtyHandle` to `PaneProps`.
2. In `onMount`, if `initialPtyHandle` is provided:
   - call `props.onPtyReady(props.model.id, initialPtyHandle)`
   - `setPtyHandle(initialPtyHandle)`
   - attach `onData` / `onExit` listeners
   - skip `spawn`.
3. If `initialPtyHandle` is not provided, keep existing spawn path.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/pane.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pane.tsx src/types.ts tests/pane.test.tsx
git commit -m "feat: Paneが再マウント時に初期PTYハンドルを再利用可能にする"
```

---

## Task 2: `LayoutManager` owns pane-to-PTY handle mapping

**Files:**
- Modify: `src/layout-manager.tsx`
- Modify: `src/types.ts` (if new type needed)
- Test: `tests/layout-manager.test.tsx`

**Interfaces:**
- Consumes:
  - `PaneModel` tree.
  - `LayoutPtyManager` and optional `PaneBackend`.
- Produces:
  - `LayoutManager` passes `initialPtyHandle` to each `LayoutNode` based on `model().id`.
  - `LayoutNode` passes the handle down to `Pane`.
  - When `onPtyReady` fires, `LayoutManager` stores `handle` in a local `Map<PaneId, PtyHandle>`.

- [ ] **Step 1: Write the failing test**

Add a test in `tests/layout-manager.test.tsx` that:
1. Renders a single pane.
2. Verifies `spawn` is called once for the initial pane.
3. Simulates a layout change that remounts the same pane id (e.g., swap the tree to a new split where the original leaf survives under a new parent).
4. Verifies `spawn` is NOT called a second time for the same pane id.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/layout-manager.test.tsx`
Expected: FAIL because current `LayoutManager` has no handle map and `Pane` always spawns.

- [ ] **Step 3: Write minimal implementation**

In `src/layout-manager.tsx`:
1. Add `const ptyHandles = new Map<PaneId, PtyHandle>()` inside `LayoutManager` (use `createSignal` only if reactive reads are needed; a plain map is fine if `Pane` receives it via prop at render time).
2. Define a helper `getPtyHandle(paneId: PaneId): PtyHandle | undefined`.
3. Update `onPtyReady` handler to store the handle: `ptyHandles.set(paneId, handle)`. The handle must be retrieved from the spawn result; capture it inside the `Pane` spawn promise and pass it back. To do this cleanly, change `Pane`'s `onPtyReady` to receive `(paneId, handle)` where `handle` is the `PtyHandle`, not just the id. Alternatively, return the handle from `Pane`'s internal spawn via a new callback `onPtyHandle`. The simpler path: extend `onPtyReady` signature to pass the full `PtyHandle`.

   - Change `onPtyReady: (paneId: string, ptyId: PtyId) => Promise<void>` to `onPtyReady: (paneId: string, handle: PtyHandle) => Promise<void>`.
   - Update `LayoutController` and tests accordingly.
4. Pass `initialPtyHandle={getPtyHandle(model().id)}` from `LayoutManager` to `LayoutNode` and then to `Pane`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/layout-manager.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/layout-manager.tsx src/types.ts tests/layout-manager.test.tsx
git commit -m "feat: LayoutManagerがpane idごとにPTYハンドルを保持し再マウント時に再利用する"
```

---

## Task 3: Update integration test expectations

**Files:**
- Modify: `tests/index.test.ts`

**Interfaces:**
- Consumes: new behavior from Task 1 and Task 2.
- Produces: test asserts no respawn for surviving pane.

- [ ] **Step 1: Write the updated failing test**

In `tests/index.test.ts`, change the test `"replaces the surviving PTY session when split collapse remounts its pane"` to `"preserves the surviving PTY session when split collapse remounts its pane"` and update assertions:
- After split: `nextPtyId === 2` (initial pane keeps pty-1, new pane gets pty-2).
- After close: `nextPtyId === 2` (surviving pane still uses pty-1; closed pane's pty-2 is terminated).
- After close: `terminated.join(",") === "pty-2"`.

- [ ] **Step 2: Run test to verify it fails against current code**

Run: `bun test tests/index.test.ts`
Expected: FAIL with new expectations.

- [ ] **Step 3: Confirm Tasks 1-2 make it pass**

After Tasks 1-2 are complete, run: `bun test tests/index.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/index.test.ts
git commit -m "test: レイアウト変更時の存続ペインPTY再生成を成功条件から外す"
```

---

## Task 4: Verify full suite and build

**Files:**
- Entire project.

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: All tests pass.

- [ ] **Step 2: Run build**

Run: `bun run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Run linter / type check**

Run project-appropriate commands (e.g., `bunx tsc --noEmit`, `bunx biome check`, etc.).
Expected: Clean output.

- [ ] **Step 4: Commit final changes if any**

```bash
git add .
git commit -m "chore: 全テストとビルドを確認"
```

---

## Open Questions / Risks

- `Pane`'s `onPtyReady` signature change affects callers in `LayoutManager` and tests. Verify all call sites.
- `LayoutManager` storing `PtyHandle` directly means close logic must explicitly remove entries and terminate only the closed pane. Existing `closePane` already terminates the target leaf before tree mutation; confirm the terminated PTY id is correct.
- `Pane` cleanup on unmount must still call `onPtyCleanup` for the handle it holds, even when reusing an initial handle. This is important to avoid leaks if the pane is actually destroyed (not remounted).
