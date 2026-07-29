import type { PtyHandle, PtyId, PtyManager } from "../src/pty-manager";
import type { PtyOptions } from "../src/types";

type PtyExitEvent = { readonly exitCode: number; readonly signal?: number };

export class FakePtyManager implements Pick<PtyManager, "spawn" | "terminate" | "terminateAll"> {
  readonly spawnedOptions: PtyOptions[] = [];
  readonly terminatedIds: PtyId[] = [];
  readonly writes = new Map<PtyId, string[]>();
  private readonly dataCallbacks = new Map<PtyId, Set<(data: string) => void>>();
  private readonly exitCallbacks = new Map<PtyId, Set<(event: PtyExitEvent) => void>>();
  private readonly dataHistory = new Map<PtyId, string[]>();
  private readonly exitHistory = new Map<PtyId, PtyExitEvent>();
  private nextId = 0;

  async spawn(options: PtyOptions): Promise<PtyHandle> {
    const id = `fake-pty-${++this.nextId}`;
    this.spawnedOptions.push(options);
    this.writes.set(id, []);
    this.dataCallbacks.set(id, new Set());
    this.exitCallbacks.set(id, new Set());
    this.dataHistory.set(id, []);

    return {
      id,
      write: (data) => {
        this.writes.get(id)?.push(data);
      },
      resize: () => {},
      onData: (callback) => {
        for (const data of this.dataHistory.get(id) ?? []) {
          callback(data);
        }
        this.dataCallbacks.get(id)?.add(callback);
        return () => this.dataCallbacks.get(id)?.delete(callback);
      },
      onExit: (callback) => {
        const exit = this.exitHistory.get(id);
        if (exit) callback(exit);
        this.exitCallbacks.get(id)?.add(callback);
        return () => this.exitCallbacks.get(id)?.delete(callback);
      },
    };
  }

  async terminate(id: PtyId): Promise<void> {
    this.terminatedIds.push(id);
    this.emitExit(id, { exitCode: 0 });
  }

  async terminateAll(): Promise<void> {
    await Promise.all([...this.dataCallbacks.keys()].map((id) => this.terminate(id)));
  }

  emitData(id: PtyId, data: string): void {
    const history = this.dataHistory.get(id);
    if (!history) return;
    history.push(data);
    for (const callback of this.dataCallbacks.get(id) ?? []) {
      callback(data);
    }
  }

  emitExit(id: PtyId, event: PtyExitEvent): void {
    if (!this.dataCallbacks.has(id)) return;
    this.exitHistory.set(id, event);
    for (const callback of this.exitCallbacks.get(id) ?? []) {
      callback(event);
    }
  }
}
