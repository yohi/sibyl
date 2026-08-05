/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { Pane } from "../src/pane";
import type { PaneSpawner } from "../src/pane-backend";

test("renders 1000 PTY output samples with p95 <= 50ms and p99 <= 100ms", async () => {
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

  // Use a tall virtual terminal so all 1000 sample lines remain visible in
  // the captured frame. This isolates the onData-to-render latency from
  // scrolling behavior.
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
    { width: 80, height: 1002 },
  );

  try {
    await view.renderOnce();
    await view.flush();
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (emitData === undefined) throw new Error("Pane did not subscribe to PTY output");

    // Warm-up render before measurement to avoid flaky first-frame costs in CI.
    await view.renderOnce();

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
}, 60_000);
