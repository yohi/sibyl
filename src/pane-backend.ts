import type { PaneModel, PtyOptions } from "./types.js";

export interface PaneBackend {
  create(options: PtyOptions): PaneModel;
}
