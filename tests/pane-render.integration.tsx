/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { LayoutManager, createLayoutManagerController } from "../src/layout-manager";
import { Pane } from "../src/pane";
import type { PaneSpawner } from "../src/pane-backend";
import type { PtyManager } from "../src/pty-manager";
import type { PaneModel } from "../src/types";

test("renders PTY output within one frame", async () => {
  // Given
  let emitData: ((data: string) => void) | undefined;
  const ptyManager = {
    spawn: async () => ({
      id: "pty-1",
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
        model={{ id: "pane-1", ptyOptions: { command: "fake-shell", args: [] } }}
        ptyManager={ptyManager}
        focused={false}
        onFocus={() => {}}
        onPtyReady={async () => {}}
      />
    ),
    { width: 40, height: 4 },
  );

  try {
    await view.renderOnce();
    await view.flush();
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (emitData === undefined) throw new Error("Pane did not subscribe to PTY output");

    // This test verifies the PTY output reaches the OpenTUI render tree within
    // the next frame. The separate pty-render-latency.integration.tsx exercises the
    // 1000-sample statistical requirement (p95 <= 50ms, p99 <= 100ms).
    await view.renderOnce();

    // When
    emitData("frame-visible\n");
    await view.renderOnce();
    const frame = view.captureCharFrame();

    // Then
    expect(frame).toContain("frame-visible");
  } finally {
    view.renderer.destroy();
  }
});

test("updates the displayed pane ratio after changing an already-rendered pane weight", async () => {
  const listeners = new Map<string, (data: string) => void>();
  let nextPtyId = 0;
  const ptyManager = {
    spawn: async () => {
      const id = `pty-${++nextPtyId}`;
      return {
        id,
        write: () => {},
        resize: () => {},
        onData: (listener: (data: string) => void) => {
          listeners.set(id, listener);
          return () => listeners.delete(id);
        },
        onExit: () => () => {},
      };
    },
    terminate: async () => {},
  } satisfies PaneSpawner & Pick<PtyManager, "terminate">;
  const model = {
    id: "root",
    direction: "horizontal",
    children: [
      { id: "left", ptyOptions: { command: "fake-shell", args: [] } },
      { id: "right", ptyOptions: { command: "fake-shell", args: [] } },
    ],
  } satisfies PaneModel;
  const controller = createLayoutManagerController(ptyManager, model);
  const view = await testRender(
    () => <LayoutManager controller={controller} ptyManager={ptyManager} />,
    { width: 40, height: 4 },
  );

  try {
    await view.renderOnce();
    await view.flush();
    await new Promise<void>((resolve) => setImmediate(resolve));
    listeners.get("pty-1")?.("L\n");
    listeners.get("pty-2")?.("R\n");
    await view.renderOnce();
    const before = view.captureCharFrame();
    const rightBefore = before.indexOf("R");

    controller.setPaneWeight("left", 3);
    await view.flush();
    await view.renderOnce();
    const after = view.captureCharFrame();
    expect(rightBefore).toBeGreaterThan(-1);
    expect(after.indexOf("R")).toBeGreaterThan(rightBefore);
  } finally {
    view.renderer.destroy();
  }
});
