import type { LayoutManagerController } from "./layout-manager.js";
import type { PaneBackend, PanePtyManager } from "./pane-backend.js";
import { buildAttachPtyOptions } from "./subagent-attach-args.js";
import { sanitizeError, sanitizeSessionId } from "./subagent-logger.js";
import type { SubagentLogger } from "./subagent-logger.js";
import type { AttachTarget, SubagentPaneManager } from "./subagent-types.js";
import type { PaneModel } from "./types.js";

interface AdapterDeps {
  layout: LayoutManagerController;
  paneBackend: PaneBackend;
  ptyManager: PanePtyManager;
  serverUrl: string;
  directory: string;
  username?: string | undefined;
  password?: string | undefined;
  logger: SubagentLogger;
}

export class SubagentPaneAdapter implements SubagentPaneManager {
  private readonly paneBySession = new Map<string, string>();

  constructor(private readonly deps: AdapterDeps) {}

  async open(target: AttachTarget): Promise<void> {
    if (this.paneBySession.has(target.sessionId)) return;

    try {
      const options = buildAttachPtyOptions({
        target,
        serverUrl: this.deps.serverUrl,
        directory: this.deps.directory,
        username: this.deps.username,
        password: this.deps.password,
      });
      const handle = await this.deps.paneBackend.spawn(this.deps.ptyManager, options);
      let pane: PaneModel | undefined;
      this.deps.layout.splitPane("horizontal", options, (paneOptions) => {
        pane = this.deps.paneBackend.create(paneOptions);
        return pane;
      });
      if (pane === undefined) {
        await this.deps.paneBackend.terminate(this.deps.ptyManager, handle.id);
        return;
      }
      try {
        await this.deps.layout.onPtyReady(pane.id, handle);
      } catch (error) {
        await this.deps.paneBackend.terminate(this.deps.ptyManager, handle.id);
        throw error;
      }
      this.deps.layout.forceFocus(pane.id);
      this.paneBySession.set(target.sessionId, pane.id);
    } catch (error) {
      this.deps.logger.warn(
        `[subagent] attach failed for ${sanitizeSessionId(target.sessionId.replace(/[^A-Za-z0-9-].*$/u, ""))}: ${sanitizeError(error)}`,
      );
    }
  }

  async close(sessionId: string): Promise<void> {
    const paneId = this.paneBySession.get(sessionId);
    if (paneId === undefined) return;
    try {
      await this.deps.layout.closePane(paneId);
    } finally {
      this.paneBySession.delete(sessionId);
    }
  }

  listOpen(): string[] {
    return [...this.paneBySession.keys()];
  }
}
