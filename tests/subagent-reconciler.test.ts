import { expect, test } from "bun:test";
import { createObserverReconciler } from "../src/subagent-reconciler";

test("coalesces concurrent refreshes and stops future work", async () => {
  let resolve: (() => void) | undefined;
  let calls = 0;
  const reconciler = createObserverReconciler({
    refresh: () => {
      calls += 1;
      return new Promise<void>((done) => {
        resolve = done;
      });
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  reconciler.setActive(true);
  reconciler.request();
  reconciler.request();
  expect(calls).toBe(1);
  const stopped = reconciler.stop();
  resolve?.();
  await stopped;
  reconciler.request();
  expect(calls).toBe(1);
});

test("schedules resync at five seconds and cancels the interval on stop", async () => {
  let tick: (() => void) | undefined;
  let delay = 0;
  let calls = 0;
  const timer = setInterval(() => {}, 60_000);
  const reconciler = createObserverReconciler({
    refresh: async () => {
      calls += 1;
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    setInterval: (callback, milliseconds) => {
      tick = callback;
      delay = milliseconds;
      return timer;
    },
    clearInterval: () => clearInterval(timer),
  });
  try {
    reconciler.setActive(true);
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(delay).toBe(5000);
    tick?.();
    await Promise.resolve();
    expect(calls).toBe(2);
    await reconciler.stop();
    tick?.();
    expect(calls).toBe(2);
  } finally {
    clearInterval(timer);
    await reconciler.stop();
  }
});
