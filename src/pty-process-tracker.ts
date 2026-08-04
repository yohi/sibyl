import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PtyId } from "./pty-manager.js";

const execFileAsync = promisify(execFile);
const PROCESS_SCAN_INTERVAL_MS = 250;
const SHUTDOWN_SCAN_INTERVAL_MS = 25;
const STARTUP_SCAN_INTERVAL_MS = 25;
const STARTUP_SCAN_DURATION_MS = 150;

interface ProcessEntry {
  readonly pid: number;
  readonly parentPid: number;
}

async function listProcesses(): Promise<readonly ProcessEntry[]> {
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid="], {
    signal: AbortSignal.timeout(500),
  });
  return stdout.split("\n").flatMap((line) => {
    const [pidText, parentPidText] = line.trim().split(/\s+/, 2);
    const pid = Number(pidText);
    const parentPid = Number(parentPidText);
    return Number.isInteger(pid) && pid > 0 && Number.isInteger(parentPid) && parentPid >= 0
      ? [{ pid, parentPid }]
      : [];
  });
}

function expandDescendants(
  processes: readonly ProcessEntry[],
  rootPid: number,
  descendants: Set<number>,
): void {
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
}

export class PtyProcessTracker {
  private readonly rootPids = new Map<PtyId, number>();
  private readonly descendantsByPty = new Map<PtyId, Set<number>>();
  private readonly scanErrors = new Map<PtyId, boolean>();
  private scanTimer: ReturnType<typeof setInterval> | undefined;
  private refreshPromise: Promise<void> | undefined;
  private shutdownCount = 0;
  private startupTimer: ReturnType<typeof setTimeout> | undefined;
  private inStartupUntil = 0;

  constructor(private readonly getPlatform: () => NodeJS.Platform = () => process.platform) {}

  start(id: PtyId, rootPid: number): void {
    if (this.getPlatform() === "win32" || rootPid <= 0) return;

    this.rootPids.set(id, rootPid);
    this.descendantsByPty.set(id, new Set());
    this.scanErrors.set(id, false);
    this.refresh().catch((error: unknown) => this.recordScanError(error));
    this.enterStartup();
    this.ensureScanTimer();
  }

  stop(id: PtyId): void {
    this.rootPids.delete(id);
    this.descendantsByPty.delete(id);
    this.scanErrors.delete(id);
    if (this.rootPids.size === 0) {
      this.clearScanTimer();
    }
  }

  knownPids(id: PtyId): readonly number[] {
    return [...(this.descendantsByPty.get(id) ?? [])];
  }

  isTracking(id: PtyId): boolean {
    return this.rootPids.has(id);
  }

  isTrackingUnavailable(id: PtyId): boolean {
    return this.scanErrors.get(id) ?? false;
  }

  beginShutdown(): void {
    this.enterShutdown();
  }

  endShutdown(): void {
    this.leaveShutdown();
  }

  async activePids(id: PtyId): Promise<readonly number[]> {
    await this.refresh();
    return this.knownPids(id);
  }

  async waitForExit(id: PtyId, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    this.enterShutdown();
    try {
      while (this.knownPids(id).length > 0) {
        if (Date.now() >= deadline) return false;
        await this.refresh();
        if (this.knownPids(id).length === 0) return true;
        await new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_SCAN_INTERVAL_MS));
      }
      return true;
    } finally {
      this.leaveShutdown();
    }
  }

  private enterShutdown(): void {
    this.shutdownCount += 1;
    if (this.shutdownCount === 1) {
      this.clearScanTimer();
      this.ensureScanTimer();
    }
  }

  private leaveShutdown(): void {
    this.shutdownCount -= 1;
    if (this.shutdownCount === 0) {
      this.clearScanTimer();
      this.ensureScanTimer();
    }
  }

  private enterStartup(): void {
    this.inStartupUntil = Date.now() + STARTUP_SCAN_DURATION_MS;
    if (this.startupTimer === undefined) {
      this.clearScanTimer();
      this.ensureScanTimer();
      this.startupTimer = setTimeout(() => {
        this.startupTimer = undefined;
        this.inStartupUntil = 0;
        this.clearScanTimer();
        this.ensureScanTimer();
      }, STARTUP_SCAN_DURATION_MS);
    }
  }

  private scanIntervalMs(): number {
    if (this.shutdownCount > 0) return SHUTDOWN_SCAN_INTERVAL_MS;
    if (Date.now() < this.inStartupUntil) return STARTUP_SCAN_INTERVAL_MS;
    return PROCESS_SCAN_INTERVAL_MS;
  }

  private ensureScanTimer(): void {
    if (this.scanTimer !== undefined || this.rootPids.size === 0) return;
    this.scanTimer = setInterval(() => void this.refresh(), this.scanIntervalMs());
  }

  private clearScanTimer(): void {
    if (this.scanTimer === undefined) return;
    clearInterval(this.scanTimer);
    this.scanTimer = undefined;
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise !== undefined) return this.refreshPromise;
    if (this.rootPids.size === 0) return;

    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = undefined;
    });

    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    try {
      let processes: readonly ProcessEntry[];
      try {
        processes = await listProcesses();
      } catch (error) {
        this.recordScanError(error);
        return;
      }

      const activePids = new Set(processes.map((entry) => entry.pid));

      for (const [id, rootPid] of this.rootPids) {
        const descendants = this.descendantsByPty.get(id);
        if (descendants === undefined) continue;

        expandDescendants(processes, rootPid, descendants);

        for (const pid of descendants) {
          if (!activePids.has(pid)) descendants.delete(pid);
        }

        this.scanErrors.set(id, false);
      }
    } catch (error) {
      this.recordScanError(error);
    }
  }

  private recordScanError(error: unknown): void {
    for (const id of this.rootPids.keys()) {
      const alreadyReported = this.scanErrors.get(id) ?? false;
      if (!alreadyReported) {
        console.warn(`PtyProcessTracker scan failed for ${id}:`, error);
        this.scanErrors.set(id, true);
      }
    }
  }
}
