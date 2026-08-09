import { describe, expect, test } from "bun:test";
import { sleepWithAbort } from "../src/abortable-sleep";

class TrackingSignal {
  aborted = false;
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: () => void): void {
    this.listeners.delete(listener);
  }

  abort(): void {
    this.aborted = true;
    for (const listener of this.listeners) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

describe("sleepWithAbort", () => {
  test("removes the abort listener after the timer completes", async () => {
    const signal = new TrackingSignal();

    await sleepWithAbort(0, signal as unknown as AbortSignal);

    expect(signal.listenerCount()).toBe(0);
  });

  test("removes the abort listener when the signal aborts", async () => {
    const signal = new TrackingSignal();
    const pending = sleepWithAbort(1000, signal as unknown as AbortSignal);

    signal.abort();

    await expect(pending).rejects.toThrow("Aborted");
    expect(signal.listenerCount()).toBe(0);
  });
});
