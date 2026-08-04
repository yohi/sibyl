import type { PaneBackend, PaneSpawner, PaneTerminator } from "./pane-backend.js";
import type { PtyHandle, PtyId } from "./pty-manager.js";
import type { PaneModel, PtyOptions } from "./types.js";

let idCounter = 0;

export class OpenTuiPaneBackend implements PaneBackend {
  create(options: PtyOptions): PaneModel {
    return {
      id: `opentui-pane-${++idCounter}`,
      ptyOptions: options,
    };
  }

  spawn(ptyManager: PaneSpawner, options: PtyOptions): Promise<PtyHandle> {
    return ptyManager.spawn(options);
  }

  write(session: PtyHandle, data: string): void {
    session.write(data);
  }

  resize(session: PtyHandle, columns: number, rows: number): void {
    session.resize(columns, rows);
  }

  terminate(ptyManager: PaneTerminator, ptyId: PtyId): Promise<void> {
    return ptyManager.terminate(ptyId);
  }
}
