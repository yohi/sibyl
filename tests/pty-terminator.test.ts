import { describe, expect, jest, test } from "bun:test";
import type { IEvent, IPty } from "node-pty";
import { PtyTerminator } from "../src/pty-terminator";

class ExitControlledPty implements IPty {
  readonly pid = 0;
  readonly cols = 80;
  readonly rows = 24;
  readonly process = "fake-shell";
  handleFlowControl = false;
  readonly killSignals: Array<string | undefined> = [];
  private readonly exitListeners = new Set<
    (event: { exitCode: number; signal?: number }) => void
  >();

  readonly onData: IEvent<string> = () => ({ dispose: () => {} });

  readonly onExit: IEvent<{ exitCode: number; signal?: number }> = (listener) => {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  };

  resize(): void {}
  clear(): void {}
  write(): void {}
  kill(signal?: string): void {
    this.killSignals.push(signal);
  }
  pause(): void {}
  resume(): void {}

  emitExit(): void {
    for (const listener of this.exitListeners) listener({ exitCode: 0 });
  }
}

describe("PtyTerminator", () => {
  test.skipIf(process.platform === "win32")(
    "waits for a SIGKILL exit before disposing a POSIX PTY",
    async () => {
      jest.useFakeTimers();
      try {
        const terminal = new ExitControlledPty();
        const terminals = new Map([["pty-1", terminal]]);
        let disposed = false;
        const terminator = new PtyTerminator(terminals, new Set(), () => {
          disposed = true;
        });

        const termination = terminator.terminate("pty-1", 10);
        jest.advanceTimersByTime(10);
        await Promise.resolve();

        expect(terminal.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
        expect(disposed).toBe(false);

        terminal.emitExit();
        await termination;

        expect(disposed).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    },
  );

  test.skipIf(process.platform === "win32")(
    "keeps a PTY available for retry when SIGKILL does not emit an exit",
    async () => {
      jest.useFakeTimers();
      try {
        const terminal = new ExitControlledPty();
        const terminals = new Map([["pty-1", terminal]]);
        let disposed = false;
        const terminator = new PtyTerminator(terminals, new Set(), () => {
          disposed = true;
        });

        const firstTermination = terminator.terminate("pty-1", 10);
        jest.advanceTimersByTime(20);

        await expect(firstTermination).rejects.toThrow("did not exit after SIGKILL");
        expect(disposed).toBe(false);

        const retry = terminator.terminate("pty-1", 10);
        terminal.emitExit();
        await retry;

        expect(disposed).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    },
  );
});
