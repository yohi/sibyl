import type { PaneBackend } from "./pane-backend.js";
import type { PaneModel, PtyOptions } from "./types.js";

let idCounter = 0;

export class OpenTuiPaneBackend implements PaneBackend {
  create(options: PtyOptions): PaneModel {
    return {
      id: `opentui-pane-${++idCounter}`,
      ptyOptions: options,
    };
  }
}
