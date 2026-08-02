import type { IPty } from "node-pty";
import type { PtyId } from "./pty-manager.js";

export class PtyTerminator {
  private readonly terminating = new Map<PtyId, Promise<void>>();
  private exitFallbackRegistered = false;
  private readonly terminateOnProcessExit = () => {
    for (const terminal of this.terminals.values()) {
      this.killTerminal(terminal, process.platform === "win32" ? undefined : "SIGKILL");
    }
  };

  constructor(
    private readonly terminals: Map<PtyId, IPty>,
    private readonly exited: Set<PtyId>,
    private readonly dispose: (id: PtyId) => void,
  ) {}

  registerExitFallback(): void {
    if (this.exitFallbackRegistered) return;
    process.once("exit", this.terminateOnProcessExit);
    this.exitFallbackRegistered = true;
  }

  unregisterExitFallbackWhenIdle(): void {
    if (!this.exitFallbackRegistered || this.terminals.size > 0) return;
    process.off("exit", this.terminateOnProcessExit);
    this.exitFallbackRegistered = false;
  }

  terminate(id: PtyId, gracefulTimeoutMs = 1500): Promise<void> {
    const current = this.terminating.get(id);
    if (current !== undefined) return current;

    const termination = this.terminateOnce(id, gracefulTimeoutMs);
    this.terminating.set(id, termination);
    const clearTermination = () => {
      if (this.terminating.get(id) === termination) this.terminating.delete(id);
    };
    void termination.then(clearTermination, clearTermination);
    return termination;
  }

  async terminateAll(): Promise<void> {
    await Promise.all(Array.from(this.terminals.keys()).map((id) => this.terminate(id)));
  }

  private async terminateOnce(id: PtyId, gracefulTimeoutMs: number): Promise<void> {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      this.dispose(id);
      return;
    }

    let resolveExit = () => {};
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    let exitListener: ReturnType<IPty["onExit"]> | undefined;
    exitListener = terminal.onExit(() => {
      exitListener?.dispose();
      resolveExit();
    });

    if (this.exited.has(id)) {
      exitListener?.dispose();
      resolveExit();
      await exitPromise;
      this.dispose(id);
      return;
    }

    const waitForExit = async (): Promise<boolean> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          exitPromise.then(() => true),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), gracefulTimeoutMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    };

    try {
      if (process.platform === "win32") {
        this.killTerminal(terminal);
        await waitForExit();
      } else {
        this.killTerminal(terminal, "SIGTERM");
        if (!(await waitForExit())) this.killTerminal(terminal, "SIGKILL");
      }
    } catch (error) {
      if (!this.exited.has(id)) throw error;
    } finally {
      exitListener?.dispose();
      this.dispose(id);
    }
  }

  private killTerminal(terminal: IPty, signal?: "SIGTERM" | "SIGKILL"): void {
    if (process.platform === "win32" || terminal.pid <= 0) {
      terminal.kill(signal);
      return;
    }

    try {
      process.kill(-terminal.pid, signal);
    } catch (error) {
      if (error instanceof Error) {
        terminal.kill(signal);
        return;
      }
      throw error;
    }
  }
}
