import type { SubagentConfig } from "./subagent-config.js";
import type { SubagentEvent, SubagentEventSource } from "./subagent-event-source.js";
import { sanitizeError, sanitizeSessionId } from "./subagent-logger.js";
import type { SubagentLogger } from "./subagent-logger.js";
import { validateSessionId } from "./subagent-validation.js";
import type {
  AttachTarget,
  SubagentLikeSession,
  SubagentPaneManager,
  SubagentSessionClient,
} from "./subagent-types.js";

export class SubagentLifecycleManager {
  private readonly openTargets = new Map<string, AttachTarget>();
  private readonly queue: Array<() => Promise<void>> = [];
  private drainPromise: Promise<void> | undefined;
  private started = false;

  constructor(
    private readonly deps: {
      paneManager: SubagentPaneManager;
      eventSource: SubagentEventSource;
      sessionClient: SubagentSessionClient;
      config: SubagentConfig;
      logger: SubagentLogger;
    },
  ) {
    deps.eventSource.onEvent((event) => this.enqueue(event));
    deps.eventSource.onReconnectRequired(() => this.resyncNow());
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (this.deps.config.maxPanes === 0) {
      await this.closeAllOpen();
      return;
    }
    if (!this.deps.config.enabled) return;
    this.deps.eventSource.start();
    await this.resyncNow();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.drain();
    await this.closeAllOpen();
    this.openTargets.clear();
    this.queue.length = 0;
    try {
      await this.deps.eventSource.stop();
    } catch (error) {
      this.deps.logger.warn(`[subagent] event source stop failed: ${sanitizeError(error)}`);
    }
  }

  async resyncNow(): Promise<void> {
    if (!this.started) return;
    await this.enqueueJob(async () => {
      if (!this.started) return;
      let sessions: readonly SubagentLikeSession[];
      try {
        sessions = await this.deps.sessionClient.list();
      } catch (error) {
        this.deps.logger.warn(`[subagent] resync list failed: ${sanitizeError(error)}`);
        return;
      }
      const children = sessions.filter((session) => session.parentID != null);
      const serverIds = new Set(children.map((session) => session.id));
      const openPaneIds = this.deps.paneManager.listOpen();
      for (const session of children) {
        if (!this.openTargets.has(session.id)) {
          this.queue.push(() => this.handle({ type: "subagent.created", session }));
        }
      }
      const knownIds = new Set([...openPaneIds, ...this.openTargets.keys()]);
      for (const sessionId of knownIds) {
        if (!serverIds.has(sessionId)) {
          this.queue.push(() => this.handle({ type: "subagent.deleted", sessionId }));
        }
      }
    });
  }

  openTargetsForDebug(): ReadonlyMap<string, AttachTarget> {
    return this.openTargets;
  }

  private enqueue(event: SubagentEvent): void {
    if (!this.started) return;
    void this.enqueueJob(() => this.handle(event));
  }

  private enqueueJob(job: () => Promise<void>): Promise<void> {
    this.queue.push(job);
    return this.drain();
  }

  private drain(): Promise<void> {
    if (this.drainPromise !== undefined) return this.drainPromise;
    this.drainPromise = (async () => {
      await Promise.resolve();
      try {
        for (;;) {
          const job = this.queue.shift();
          if (job === undefined) return;
          await job();
        }
      } finally {
        this.drainPromise = undefined;
      }
    })();
    return this.drainPromise;
  }

  private async handle(event: SubagentEvent): Promise<void> {
    try {
      switch (event.type) {
        case "subagent.created":
          await this.created(event.session);
          break;
        case "subagent.idle":
        case "subagent.deleted":
          await this.closed(event.sessionId);
          break;
        case "subagent.error":
          if (event.sessionId !== undefined) await this.closed(event.sessionId);
          break;
      }
    } catch (error) {
      this.deps.logger.warn(`[subagent] event handler failed: ${sanitizeError(error)}`);
    }
  }

  private async created(session: SubagentLikeSession): Promise<void> {
    if (session.parentID == null || !validateSessionId(session.id)) {
      if (session.parentID != null) {
        this.deps.logger.warn(`[subagent] invalid session ${sanitizeSessionId(session.id)}`);
      }
      return;
    }
    if (this.openTargets.has(session.id)) return;
    while (this.deps.paneManager.listOpen().length >= this.deps.config.maxPanes) {
      const oldest = this.oldestSession();
      if (oldest === undefined) break;
      await this.deps.paneManager.close(oldest);
      this.openTargets.delete(oldest);
    }
    await this.deps.paneManager.open({ sessionId: session.id, createdAt: session.time.created });
    this.openTargets.set(session.id, { sessionId: session.id, createdAt: session.time.created });
  }

  private async closed(sessionId: string): Promise<void> {
    if (!this.openTargets.has(sessionId) && !this.deps.paneManager.listOpen().includes(sessionId))
      return;
    await this.deps.paneManager.close(sessionId);
    this.openTargets.delete(sessionId);
  }

  private oldestSession(): string | undefined {
    let oldest: AttachTarget | undefined;
    for (const target of this.openTargets.values()) {
      if (oldest === undefined || target.createdAt < oldest.createdAt) oldest = target;
    }
    return oldest?.sessionId ?? this.deps.paneManager.listOpen()[0];
  }

  private async closeAllOpen(): Promise<void> {
    const results = await Promise.allSettled(
      this.deps.paneManager.listOpen().map((sessionId) => this.deps.paneManager.close(sessionId)),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        this.deps.logger.warn(`[subagent] cleanup failed: ${sanitizeError(result.reason)}`);
      }
    }
  }
}
