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
  private readonly openingBySession = new Map<string, Promise<void>>();

  constructor(private readonly deps: AdapterDeps) {}

  async open(target: AttachTarget): Promise<void> {
    if (this.paneBySession.has(target.sessionId)) return;
    const opening = this.openingBySession.get(target.sessionId);
    if (opening !== undefined) {
      await opening;
      return;
    }

    const openPromise = (async () => {
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
        let ownershipTransferred = false;
        try {
          this.deps.layout.splitPane("horizontal", options, (paneOptions) => {
            pane = this.deps.paneBackend.create(paneOptions);
            return pane;
          });
          if (pane === undefined) return;
          await this.deps.layout.onPtyReady(pane.id, handle);
          ownershipTransferred = true;
          this.deps.layout.forceFocus(pane.id);
          this.paneBySession.set(target.sessionId, pane.id);
        } finally {
          if (!ownershipTransferred) {
            await this.deps.paneBackend.terminate(this.deps.ptyManager, handle.id);
          }
        }
      } catch (error) {
        this.deps.logger.warn(
          `[subagent] attach failed for ${sanitizeSessionId(target.sessionId.replace(/[^A-Za-z0-9-].*$/u, ""))}: ${sanitizeError(error)}`,
        );
      }
    })();
    this.openingBySession.set(target.sessionId, openPromise);
    try {
      await openPromise;
    } finally {
      if (this.openingBySession.get(target.sessionId) === openPromise) {
        this.openingBySession.delete(target.sessionId);
      }
    }
  }

  async close(sessionId: string): Promise<void> {
    const paneId = this.paneBySession.get(sessionId);
    if (paneId === undefined) return;
    await this.deps.layout.closePane(paneId);
    this.paneBySession.delete(sessionId);
  }

  listOpen(): string[] {
    return [...this.paneBySession.keys()];
  }
}
