import type { IPty } from "node-pty";
import type { PtyId } from "./pty-manager.js";

export interface PtyDescendantController {
  isTracking(id: PtyId): boolean;
  knownPids(id: PtyId): readonly number[];
  activePids(id: PtyId): Promise<readonly number[]>;
  waitForExit(id: PtyId, timeoutMs: number): Promise<boolean>;
  stop(id: PtyId): void;
}

export class PtyTerminationTimeoutError extends Error {
  constructor(ptyId: PtyId) {
    super(`PTY ${ptyId} did not exit after SIGKILL`);
    this.name = "PtyTerminationTimeoutError";
  }
}

export class PtyTerminator {
  private readonly terminating = new Map<PtyId, Promise<void>>();
  private exitFallbackRegistered = false;
  private readonly terminateOnProcessExit = () => {
    for (const [id, terminal] of this.terminals) {
      this.killTerminal(terminal, process.platform === "win32" ? undefined : "SIGKILL");
      this.killDescendants(this.descendants?.knownPids(id) ?? [], "SIGKILL");
    }
  };

  constructor(
    private readonly terminals: Map<PtyId, IPty>,
    private readonly exited: Set<PtyId>,
    private readonly dispose: (id: PtyId) => void,
    private readonly descendants?: PtyDescendantController,
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

    let exited = false;
    let forceDisposed = false;
    let resolveExit = () => {};
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    let exitListener: ReturnType<IPty["onExit"]> | undefined;
    exitListener = terminal.onExit(() => {
      exited = true;
      exitListener?.dispose();
      resolveExit();
    });

    if (this.exited.has(id)) {
      exitListener?.dispose();
      resolveExit();
      await exitPromise;
      await this.terminateDescendants(id, gracefulTimeoutMs);
      this.dispose(id);
      return;
    }

    const waitForExit = async (): Promise<boolean> => {
      if (this.exited.has(id)) return true;
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
        if (!(await waitForExit())) throw new PtyTerminationTimeoutError(id);
      } else {
        const activeDescendants = this.descendants?.isTracking(id)
          ? await this.descendants.activePids(id)
          : [];
        this.killTerminal(terminal, "SIGTERM");
        let terminatedDescendants = false;
        if (activeDescendants.length > 0) {
          this.killDescendants(activeDescendants, "SIGTERM");
          terminatedDescendants = await this.terminateDescendants(id, gracefulTimeoutMs);
        }
        if (terminatedDescendants) {
          this.killTerminal(terminal, "SIGKILL");
          forceDisposed = true;
        } else if (!(await waitForExit())) {
          this.killTerminal(terminal, "SIGKILL");
          if (!(await waitForExit())) throw new PtyTerminationTimeoutError(id);
        }
      }
    } finally {
      exitListener?.dispose();
      if (forceDisposed || exited || this.exited.has(id)) this.dispose(id);
    }
  }

  private killTerminal(terminal: IPty, signal?: "SIGTERM" | "SIGKILL"): void {
    if (process.platform === "win32" || terminal.pid <= 0) {
      terminal.kill(signal);
      return;
    }

    try {
      process.kill(-terminal.pid, signal);
      terminal.kill(signal);
    } catch (error) {
      if (error instanceof Error) {
        terminal.kill(signal);
        return;
      }
      throw error;
    }
  }

  private async terminateDescendants(id: PtyId, gracefulTimeoutMs: number): Promise<boolean> {
    const descendants = this.descendants;
    if (descendants === undefined || process.platform === "win32") return false;

    const activePids = await descendants.activePids(id);
    if (activePids.length === 0) return false;

    this.killDescendants(activePids, "SIGTERM");
    if (await descendants.waitForExit(id, gracefulTimeoutMs)) return true;

    this.killDescendants(await descendants.activePids(id), "SIGKILL");
    if (!(await descendants.waitForExit(id, gracefulTimeoutMs))) {
      throw new PtyTerminationTimeoutError(id);
    }
    return true;
  }

  private killDescendants(pids: readonly number[], signal: "SIGTERM" | "SIGKILL"): void {
    if (process.platform === "win32") return;
    for (const pid of pids) {
      try {
        process.kill(pid, signal);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
      }
    }
  }
}
