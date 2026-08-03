import type { IPty } from "node-pty";
import type { PtyId } from "./pty-manager.js";

export interface PtyDescendantController {
  isTracking(id: PtyId): boolean;
  knownPids(id: PtyId): readonly number[];
  activePids(id: PtyId): Promise<readonly number[]>;
  waitForExit(id: PtyId, timeoutMs: number): Promise<boolean>;
  isTrackingUnavailable(id: PtyId): boolean;
  beginShutdown(): void;
  endShutdown(): void;
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
      this.killTerminal(terminal, this.getPlatform() === "win32" ? undefined : "SIGKILL");
      this.killDescendants(this.descendants?.knownPids(id) ?? [], "SIGKILL");
    }
  };

  constructor(
    private readonly terminals: Map<PtyId, IPty>,
    private readonly exited: Set<PtyId>,
    private readonly dispose: (id: PtyId) => void,
    private readonly descendants?: PtyDescendantController,
    private readonly getPlatform: () => NodeJS.Platform = () => process.platform,
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

    const waitForExit = async (timeoutMs: number): Promise<boolean> => {
      if (this.exited.has(id)) return true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          exitPromise.then(() => true),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), timeoutMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    };

    try {
      this.descendants?.beginShutdown();
      if (this.getPlatform() === "win32") {
        await this.terminateWindows(id, terminal, waitForExit, gracefulTimeoutMs);
      } else {
        await this.terminatePosix(id, terminal, waitForExit, gracefulTimeoutMs);
      }
    } finally {
      exitListener?.dispose();
      this.descendants?.endShutdown();
      this.dispose(id);
    }
  }

  private async terminateWindows(
    id: PtyId,
    terminal: IPty,
    waitForExit: (timeoutMs: number) => Promise<boolean>,
    gracefulTimeoutMs: number,
  ): Promise<void> {
    this.killTerminal(terminal);
    if (!(await waitForExit(gracefulTimeoutMs))) throw new PtyTerminationTimeoutError(id);
  }

  private async terminatePosix(
    id: PtyId,
    terminal: IPty,
    waitForExit: (timeoutMs: number) => Promise<boolean>,
    gracefulTimeoutMs: number,
  ): Promise<void> {
    if (this.descendants?.isTrackingUnavailable(id)) {
      throw new Error(`PTY ${id} descendant tracking is unavailable`);
    }

    const deadline = Date.now() + gracefulTimeoutMs;
    const descendantTargets = this.descendants?.isTracking(id)
      ? await this.waitForTargets(Math.min(gracefulTimeoutMs, 200), id)
      : [];

    this.killTerminal(terminal, "SIGTERM");
    let terminatedDescendants = false;
    if (descendantTargets.length > 0) {
      this.killDescendants(descendantTargets, "SIGTERM");
      const remainingMs = Math.max(0, deadline - Date.now());
      terminatedDescendants = await this.terminateDescendants(id, remainingMs);
    }

    if (terminatedDescendants) {
      this.killTerminal(terminal, "SIGKILL");
      const remainingMs = Math.max(0, deadline - Date.now());
      if (!(await waitForExit(remainingMs))) throw new PtyTerminationTimeoutError(id);
      return;
    }

    const waitMs = Math.max(0, deadline - Date.now());
    if (await waitForExit(waitMs)) return;

    this.killTerminal(terminal, "SIGKILL");
    const finalWaitMs = Math.max(0, deadline - Date.now());
    if (!(await waitForExit(finalWaitMs))) throw new PtyTerminationTimeoutError(id);
  }

  private killTerminal(terminal: IPty, signal?: "SIGTERM" | "SIGKILL"): void {
    if (this.getPlatform() === "win32" || terminal.pid <= 0) {
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

  private async terminateDescendants(id: PtyId, remainingMs: number): Promise<boolean> {
    const descendants = this.descendants;
    if (descendants === undefined || this.getPlatform() === "win32") return false;

    const startedAt = Date.now();
    const targets = await this.waitForTargets(remainingMs, id);
    if (targets.length === 0) return false;
    this.killDescendants(targets, "SIGTERM");
    const termWaitMs = Math.max(0, remainingMs - (Date.now() - startedAt));
    if (await descendants.waitForExit(id, termWaitMs)) return true;

    const killStartedAt = Date.now();
    const nextTargets = await this.waitForTargets(
      Math.max(0, remainingMs - (Date.now() - startedAt)),
      id,
    );
    if (nextTargets.length === 0) return true;

    this.killDescendants(nextTargets, "SIGKILL");
    const killWaitMs = Math.max(0, remainingMs - (Date.now() - killStartedAt));
    if (!(await descendants.waitForExit(id, killWaitMs))) {
      throw new PtyTerminationTimeoutError(id);
    }
    return true;
  }

  private async waitForTargets(timeoutMs: number, id: PtyId): Promise<number[]> {
    const descendants = this.descendants;
    if (descendants === undefined) return [];

    const deadline = Date.now() + timeoutMs;
    const intervalMs = 25;
    let targets: number[] = [];
    do {
      const knownPids = descendants.knownPids(id);
      const activePids = await descendants.activePids(id);
      targets = [...new Set([...knownPids, ...activePids])];
      if (targets.length > 0) return targets;
      const remainingMs = Math.max(0, deadline - Date.now());
      const waitMs = Math.min(intervalMs, remainingMs);
      if (waitMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      }
    } while (Date.now() < deadline);

    return targets;
  }

  private killDescendants(pids: readonly number[], signal: "SIGTERM" | "SIGKILL"): void {
    if (this.getPlatform() === "win32") return;
    for (const pid of pids) {
      try {
        process.kill(pid, signal);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
      }
    }
  }
}
