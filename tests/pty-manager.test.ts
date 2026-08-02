import { describe, expect, test } from "bun:test";
import type { IEvent, IPty } from "node-pty";
import { PtyManager } from "../src/pty-manager";

class FakePty implements IPty {
  readonly pid = 1;
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

  if (process.versions.bun !== undefined) {
    test("uses the built-in Bun PTY adapter when no adapter is injected", async () => {
      const manager = new PtyManager(undefined, async () => {
        throw new Error("node-pty loader invoked");
      });
      const expectedError =
        process.platform === "win32"
          ? "Bun on Windows does not yet support PTY. Please provide a Bun PTY adapter."
          : 'Executable not found in $PATH: "fake-shell"';

      await expect(manager.spawn({ command: "fake-shell", args: [] })).rejects.toThrow(
        expectedError,
      );
    });
  }
});

if (process.versions.bun === undefined) {
  describe("PtyManager with node-pty", () => {
    test("spawns a shell and receives data", async () => {
      const manager = new PtyManager();
      const shell = process.platform === "win32" ? "cmd.exe" : "bash";
      const pty = await manager.spawn({ command: shell, args: [], cols: 80, rows: 24 });

      const dataPromise = new Promise<string>((resolve) => {
        pty.onData((data) => {
          if (data.length > 0) resolve(data);
        });
      });

      pty.write("echo hello\r");
      const data = await dataPromise;
      expect(data).toContain("hello");

      await manager.terminate(pty.id);
    });
  });
}
