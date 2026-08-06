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
    const totalSamples = 1000;
    const emitIntervalMs = 10;
    const capturePollIntervalMs = 5;
    const captureTimeoutMs = 50_000;
    const sentAt = new Map<number, number>();
    const observedSamples = new Set<number>();
    let nextSampleToObserve = 0;
    const wait = (durationMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, durationMs));

    const captureDeadline = performance.now() + captureTimeoutMs;
    const captureFrames = async () => {
      while (observedSamples.size < totalSamples && performance.now() < captureDeadline) {
        await view.renderOnce();
        const frame = view.captureCharFrame();
        const capturedAt = performance.now();

        while (nextSampleToObserve < totalSamples) {
          const sampleIndex = nextSampleToObserve;
          const sampleSentAt = sentAt.get(sampleIndex);
          if (sampleSentAt === undefined || !frame.includes(`sample-${sampleIndex}`)) break;

          if (!observedSamples.has(sampleIndex)) {
            observedSamples.add(sampleIndex);
            samples.push(capturedAt - sampleSentAt);
          }
          nextSampleToObserve++;
        }

        if (observedSamples.size < totalSamples) {
          await wait(capturePollIntervalMs);
        }
      }
    };

    const emitSamples = async (emitData: (data: string) => void) => {
      const emissionStartedAt = performance.now();
      for (let i = 0; i < totalSamples; i++) {
        const delayMs = emissionStartedAt + i * emitIntervalMs - performance.now();
        if (delayMs > 0) {
          await wait(delayMs);
        }

        const payload = `sample-${i}\n`;
        sentAt.set(i, performance.now());
        emitData(payload);
      }
    };

    await Promise.all([captureFrames(), emitSamples(emitData)]);

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
