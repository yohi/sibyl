import type { IEvent, IPty } from "node-pty";

type PtyModule = Pick<typeof import("node-pty"), "spawn">;

interface BunPtyOptions {
  readonly cols?: number;
  readonly rows?: number;
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly name?: string;
}

type BunSubprocess = ReturnType<typeof Bun.spawn>;

class BunPty implements IPty {
  readonly pid: number;
  cols: number;
  rows: number;
  readonly process: string;
  handleFlowControl = false;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<
    (event: { exitCode: number; signal?: number }) => void
  >();
  private readonly subprocess: BunSubprocess;
  private exitEmitted = false;

  constructor(command: string, args: string[], options: BunPtyOptions) {
    this.process = command;
    this.cols = options.cols ?? 80;
    this.rows = options.rows ?? 24;
    const textDecoder = new TextDecoder("utf-8", { fatal: false });
    let incomplete = "";

    this.subprocess = Bun.spawn([command, ...args], {
      cwd: options.cwd,
      env: options.env,
      terminal: {
        name: options.name,
        cols: this.cols,
        rows: this.rows,
        data: (_terminal, data) => {
          const chunk = textDecoder.decode(data, { stream: true });
          const text = incomplete + chunk;
          const lastCodePoint = text.charCodeAt(text.length - 1);
          if (lastCodePoint >= 0xd800 && lastCodePoint <= 0xdbff) {
            incomplete = text.slice(-1);
          } else {
            incomplete = "";
          }
          const emitText = incomplete ? text.slice(0, -1) : text;
          for (const listener of this.dataListeners) {
            listener(emitText);
          }
        },
        exit: async (_terminal, _exitCode, _signal) => {
          await this.emitExit(undefined);
          this.subprocess.terminal?.close();
        },
      },
    });
    this.pid = this.subprocess.pid;
  }

  readonly onData: IEvent<string> = (listener) => {
    this.dataListeners.add(listener);
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
    this.subprocess.terminal?.resize(columns, rows);
    this.cols = columns;
    this.rows = rows;
  }

  // Intentionally empty: required by the IPty contract but not implemented by Bun PTY.
  clear(): void {}

  write(data: Parameters<IPty["write"]>[0]): void {
    this.subprocess.terminal?.write(String(data));
  }

  kill(signal?: string): void {
    const normalizedSignal = signal === "SIGTERM" || signal === "SIGKILL" ? signal : undefined;
    if (normalizedSignal !== undefined) {
      this.subprocess.kill(normalizedSignal);
    } else {
      this.subprocess.kill();
    }
    void this.subprocess.exited.then(() => this.emitExit(normalizedSignal));
  }

  // Intentionally empty: required by the IPty contract but not implemented by Bun PTY.
  pause(): void {}
  // Intentionally empty: required by the IPty contract but not implemented by Bun PTY.
  resume(): void {}

  private async emitExit(signal?: string): Promise<void> {
    if (this.exitEmitted) return;
    this.exitEmitted = true;
    const exitCode = await this.subprocess.exited;
    const signalNumber = signal === "SIGKILL" ? 9 : signal === "SIGTERM" ? 15 : undefined;
    for (const listener of this.exitListeners) {
      listener({ exitCode, signal: signalNumber });
    }
  }
}

export function createBunPtyAdapter(): PtyModule {
  return {
    spawn: (command, args, options) =>
      new BunPty(command, Array.isArray(args) ? args : [String(args)], {
        cols: (options as { cols?: number }).cols,
        rows: (options as { rows?: number }).rows,
        cwd: (options as { cwd?: string }).cwd,
        env: (options as { env?: Record<string, string | undefined> }).env,
        name: (options as { name?: string }).name,
      }),
  };
}
