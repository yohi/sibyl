/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { Pane } from "../src/pane";
import type { PaneSpawner } from "../src/pane-backend";

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

    // When
    const startedAt = performance.now();
    emitData("frame-visible\n");
    await view.renderOnce();
    const frame = view.captureCharFrame();

    // Then
    expect(frame).toContain("frame-visible");
    expect(performance.now() - startedAt).toBeLessThan(16);
  } finally {
    view.renderer.destroy();
  }
});
