import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PtyId } from "./pty-manager.js";

const execFileAsync = promisify(execFile);
const PROCESS_SCAN_INTERVAL_MS = 25;

interface ProcessEntry {
  readonly pid: number;
  readonly parentPid: number;
}

async function listProcesses(): Promise<readonly ProcessEntry[]> {
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid="]);
  return stdout.split("\n").flatMap((line) => {
    const [pidText, parentPidText] = line.trim().split(/\s+/, 2);
    const pid = Number(pidText);
    const parentPid = Number(parentPidText);
    return Number.isInteger(pid) && pid > 0 && Number.isInteger(parentPid) && parentPid >= 0
      ? [{ pid, parentPid }]
      : [];
  });
}

export class PtyProcessTracker {
  private readonly rootPids = new Map<PtyId, number>();
  private readonly descendantsByPty = new Map<PtyId, Set<number>>();
  private readonly scanTimers = new Map<PtyId, ReturnType<typeof setInterval>>();

  start(id: PtyId, rootPid: number): void {
    if (process.platform === "win32" || rootPid <= 0) return;

    this.rootPids.set(id, rootPid);
    this.descendantsByPty.set(id, new Set());
    void this.refresh(id);
    this.scanTimers.set(
      id,
      setInterval(() => void this.refresh(id), PROCESS_SCAN_INTERVAL_MS),
    );
  }

  stop(id: PtyId): void {
    const timer = this.scanTimers.get(id);
    if (timer !== undefined) clearInterval(timer);
    this.scanTimers.delete(id);
    this.rootPids.delete(id);
    this.descendantsByPty.delete(id);
  }

  knownPids(id: PtyId): readonly number[] {
    return [...(this.descendantsByPty.get(id) ?? [])];
  }

  isTracking(id: PtyId): boolean {
    return this.rootPids.has(id);
  }

  async activePids(id: PtyId): Promise<readonly number[]> {
    await this.refresh(id);
    return this.knownPids(id);
  }

  async waitForExit(id: PtyId, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while ((await this.activePids(id)).length > 0) {
      if (Date.now() >= deadline) return false;
      await new Promise<void>((resolve) => setTimeout(resolve, PROCESS_SCAN_INTERVAL_MS));
    }
    return true;
  }

  private async refresh(id: PtyId): Promise<void> {
    const rootPid = this.rootPids.get(id);
    const descendants = this.descendantsByPty.get(id);
    if (rootPid === undefined || descendants === undefined) return;

    try {
      const processes = await listProcesses();
      const activePids = new Set(processes.map((entry) => entry.pid));
      const parentPids = new Set([rootPid, ...descendants]);

      let foundDescendant = true;
      while (foundDescendant) {
        foundDescendant = false;
        for (const process of processes) {
          if (parentPids.has(process.parentPid) && !descendants.has(process.pid)) {
            descendants.add(process.pid);
            parentPids.add(process.pid);
            foundDescendant = true;
          }
        }
      }

      for (const pid of descendants) {
        if (!activePids.has(pid)) descendants.delete(pid);
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
  }
}
