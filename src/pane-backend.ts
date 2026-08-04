import type { PtyHandle, PtyId, PtyManager } from "./pty-manager.js";
import type { PaneModel, PtyOptions } from "./types.js";

export type PaneSpawner = Pick<PtyManager, "spawn">;
export type PaneTerminator = Pick<PtyManager, "terminate">;
export type PanePtyManager = PaneSpawner & PaneTerminator;

export interface PaneBackend {
  create(options: PtyOptions): PaneModel;
  spawn(ptyManager: PaneSpawner, options: PtyOptions): Promise<PtyHandle>;
  write(session: PtyHandle, data: string): void;
  resize(session: PtyHandle, columns: number, rows: number): void;
  terminate(ptyManager: PaneTerminator, ptyId: PtyId): Promise<void>;
}
