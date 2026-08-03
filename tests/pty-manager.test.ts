import { describe, expect, jest, test } from "bun:test";
import type { IEvent, IPty } from "node-pty";
import { PtyManager } from "../src/pty-manager";

class FakePty implements IPty {
  readonly pid = 0;
  readonly cols = 80;
  readonly rows = 24;
  readonly process = "fake-shell";
  handleFlowControl = false;
  readonly writes: string[] = [];
  readonly resizes: Array<[number, number]> = [];
  readonly killSignals: Array<string | undefined> = [];
  readonly spawnCalls: Array<Parameters<typeof import("node-pty").spawn>> = [];
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<
    (event: { exitCode: number; signal?: number }) => void
  >();

  constructor(private readonly emitsExitOnKill = true) {}

  readonly onData: IEvent<string> = (listener) => {
    const isFirstListener = this.dataListeners.size === 0;
    this.dataListeners.add(listener);
    if (isFirstListener) {
      listener("fake: ready\r\n");
    }
    return {
      dispose: () => {
        this.dataListeners.delete(listener);
      },
    };
  };

  readonly onExit: IEvent<{ exitCode: number; signal?: number }> = (listener) => {
    this.exitListeners.add(listener);
    return {
      dispose: () => {
        this.exitListeners.delete(listener);
      },
    };
  };

  resize(columns: number, rows: number): void {
    this.resizes.push([columns, rows]);
  }

  clear(): void {}

  write(data: Parameters<IPty["write"]>[0]): void {
    this.writes.push(String(data));
    for (const listener of this.dataListeners) {
      listener("fake: received input\r\n");
    }
  }

  kill(signal?: string): void {
    this.killSignals.push(signal);
    if (!this.emitsExitOnKill && signal !== "SIGKILL") return;
    for (const listener of [...this.exitListeners]) {
      listener({ exitCode: 0 });
    }
  }

  pause(): void {}

  resume(): void {}
}

describe("PtyManager", () => {
  test("resize validates dimensions", async () => {
    const fakePty = new FakePty();
    const fakeNodePty = {
      spawn: (): IPty => fakePty,
    };
    const manager = new PtyManager(
      async () => fakeNodePty,
      async () => fakeNodePty,
    );
    const pty = await manager.spawn({ command: "fake-shell", args: [], cols: 80, rows: 24 });

    expect(() => pty.resize(0, 0)).not.toThrow();
    expect(fakePty.resizes).toEqual([]);

    await manager.terminate(pty.id);
  });

  test("uses an injected node-pty adapter to manage PTY input and output", async () => {
    const fakePty = new FakePty();
    const fakeNodePty = {
      spawn: (...args: Parameters<typeof import("node-pty").spawn>): IPty => {
        fakePty.spawnCalls.push(args);
        return fakePty;
      },
    };
    const manager = new PtyManager(
      async () => fakeNodePty,
      async () => fakeNodePty,
    );
    const pty = await manager.spawn({ command: "fake-shell", args: [], cols: 80, rows: 24 });
    const received: string[] = [];

    pty.onData((data) => {
      received.push(data);
    });
    pty.write("echo fake\r");
    pty.resize(120, 40);
    await manager.terminate(pty.id);

    expect(fakePty.spawnCalls).toHaveLength(1);
    expect(received).toEqual(["fake: ready\r\n", "fake: received input\r\n"]);
    expect(fakePty.writes).toEqual(["echo fake\r"]);
    expect(fakePty.resizes).toEqual([[120, 40]]);
    expect(fakePty.killSignals).toEqual([process.platform === "win32" ? undefined : "SIGTERM"]);
  });

  test("sends SIGKILL when SIGTERM does not produce an exit event", async () => {
    if (process.platform === "win32") return;

    jest.useFakeTimers();
    try {
      const fakePty = new FakePty(false);
      const fakeNodePty = { spawn: (): IPty => fakePty };
      const manager = new PtyManager(
        async () => fakeNodePty,
        async () => fakeNodePty,
      );
      const pty = await manager.spawn({ command: "fake-shell", args: [] });

      const termination = manager.terminate(pty.id, 10);
      jest.advanceTimersByTime(10);
      await termination;

      expect(fakePty.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
    } finally {
      jest.useRealTimers();
    }
  });

  test.skipIf(process.platform === "win32")(
    "shares an in-flight termination for the same PTY",
    async () => {
      // Given

      jest.useFakeTimers();
      try {
        const fakePty = new FakePty(false);
        const fakeNodePty = { spawn: (): IPty => fakePty };
        const manager = new PtyManager(
          async () => fakeNodePty,
          async () => fakeNodePty,
        );
        const pty = await manager.spawn({ command: "fake-shell", args: [] });

        // When
        const first = manager.terminate(pty.id, 10);
        const second = manager.terminate(pty.id, 10);
        jest.advanceTimersByTime(10);
        await Promise.all([first, second]);

        // Then
        expect(fakePty.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
      } finally {
        jest.useRealTimers();
      }
    },
  );

  if (process.versions.bun !== undefined) {
    test("uses the external PTY loader on Bun for Windows", async () => {
      // Given
      const fakePty = new FakePty();
      let loaderCalls = 0;
      const externalPty = { spawn: (): IPty => fakePty };
      const manager = new PtyManager(
        undefined,
        async () => {
          loaderCalls += 1;
          return externalPty;
        },
        () => "win32",
      );

      // When
      const pty = await manager.spawn({ command: "fake-shell", args: [] });

      // Then
      expect(loaderCalls).toBe(1);
      await manager.terminate(pty.id);
    });

    test.skipIf(process.platform === "win32")(
      "uses the built-in Bun PTY adapter when no adapter is injected",
      async () => {
        const manager = new PtyManager(undefined, async () => {
          throw new Error("node-pty loader invoked");
        });

        await expect(manager.spawn({ command: "fake-shell", args: [] })).rejects.toThrow(
          'Executable not found in $PATH: "fake-shell"',
        );
      },
    );
  }
});

if (process.versions.bun === undefined) {
  describe("PtyManager with node-pty", () => {
    test("spawns a shell and receives data", async () => {
      const manager = new PtyManager();
      const shell = process.platform === "win32" ? "cmd.exe" : "bash";
      const pty = await manager.spawn({ command: shell, args: [], cols: 80, rows: 24 });

      const dataPromise = new Promise<string>((resolve) => {
        let accumulated = "";
        pty.onData((data) => {
          accumulated += data;
          if (accumulated.includes("hello")) {
            resolve(accumulated);
          }
        });
      });

      pty.write("echo hello\r");
      const data = await dataPromise;
      expect(data).toContain("hello");

      await manager.terminate(pty.id);
    });
  });
}
