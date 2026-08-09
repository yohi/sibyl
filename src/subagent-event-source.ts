import { sanitizeError } from "./subagent-logger.js";
import type { SubagentLogger } from "./subagent-logger.js";
import type { SubagentLikeSession } from "./subagent-types.js";

export type SubagentEvent =
  | { type: "subagent.created"; session: SubagentLikeSession }
  | { type: "subagent.idle"; sessionId: string }
  | { type: "subagent.error"; sessionId?: string }
  | { type: "subagent.deleted"; sessionId: string };

export interface SubagentEventSource {
  start(): void;
  stop(): Promise<void>;
  onEvent(handler: (event: SubagentEvent) => void): void;
  onReconnectRequired(handler: () => Promise<void> | void): void;
}

export interface TuiEventBusLike {
  on(type: string, handler: (event: unknown) => void): () => void;
  off?(type: string, handler: (event: unknown) => void): void;
}

function sessionFromEvent(event: unknown): SubagentLikeSession | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const info = (event as { properties?: { info?: unknown } }).properties?.info;
  if (typeof info !== "object" || info === null) return undefined;
  const value = info as { id?: unknown; parentID?: unknown; time?: { created?: unknown } };
  if (typeof value.id !== "string" || typeof value.time?.created !== "number") return undefined;
  if (typeof value.parentID !== "string") return undefined;
  return { id: value.id, parentID: value.parentID, time: { created: value.time.created } };
}

function sessionIdFromEvent(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const value = (event as { properties?: { sessionID?: unknown } }).properties?.sessionID;
  return typeof value === "string" ? value : undefined;
}

export class TuiEventBusSource implements SubagentEventSource {
  private readonly handlers: Array<(event: SubagentEvent) => void> = [];
  private readonly childSessionIds = new Set<string>();
  private offFns: Array<() => void> = [];

  constructor(private readonly deps: { eventBus: TuiEventBusLike; logger: SubagentLogger }) {}

  start(): void {
    if (this.offFns.length > 0) return;
    const { eventBus } = this.deps;
    this.offFns = [
      eventBus.on("session.created", (event) => {
        const session = sessionFromEvent(event);
        if (session !== undefined) {
          this.childSessionIds.add(session.id);
          this.emit({ type: "subagent.created", session });
        }
      }),
      eventBus.on("session.deleted", (event) => {
        const session = sessionFromEvent(event);
        if (session !== undefined) {
          this.childSessionIds.delete(session.id);
          this.emit({ type: "subagent.deleted", sessionId: session.id });
        }
      }),
      eventBus.on("session.idle", (event) => {
        const sessionId = sessionIdFromEvent(event);
        if (sessionId !== undefined && this.childSessionIds.has(sessionId)) {
          this.emit({ type: "subagent.idle", sessionId });
        }
      }),
      eventBus.on("session.error", (event) => {
        const sessionId = sessionIdFromEvent(event);
        if (sessionId === undefined) {
          this.deps.logger.error("[subagent] session.error without sessionID");
          return;
        }
        if (this.childSessionIds.has(sessionId)) this.emit({ type: "subagent.error", sessionId });
      }),
    ];
  }

  async stop(): Promise<void> {
    for (const off of this.offFns) off();
    this.offFns = [];
    this.childSessionIds.clear();
  }

  onEvent(handler: (event: SubagentEvent) => void): void {
    this.handlers.push(handler);
  }

  onReconnectRequired(_handler: () => Promise<void> | void): void {}

  private emit(event: SubagentEvent): void {
    for (const handler of this.handlers) handler(event);
  }
}

export function buildSseHeaders(auth: {
  username?: string;
  password?: string;
}): Record<string, string> {
  if (auth.password === undefined) return {};
  const credentials = `${auth.username ?? ""}:${auth.password}`;
  return {
    Authorization: `Basic ${Buffer.from(credentials).toString("base64")}`,
  };
}

export interface SseDeps {
  subscribe(
    signal: AbortSignal,
    headers: Readonly<Record<string, string>>,
  ): Promise<{ stream: AsyncIterable<unknown> }>;
  listSessions(signal: AbortSignal): Promise<readonly SubagentLikeSession[]>;
  auth: { username?: string; password?: string };
  logger: SubagentLogger;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  lifecycleSignal?: AbortSignal;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export class SseEventSource implements SubagentEventSource {
  private readonly handlers: Array<(event: SubagentEvent) => void> = [];
  private readonly reconnectHandlers: Array<() => Promise<void> | void> = [];
  private readonly childSessionIds = new Set<string>();
  private stopped = true;
  private loopPromise: Promise<void> | undefined;
  private controller: AbortController | undefined;

  constructor(private readonly deps: SseDeps) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.controller = new AbortController();
    if (this.deps.lifecycleSignal?.aborted) {
      this.stopped = true;
      this.controller.abort();
      return;
    } else {
      this.deps.lifecycleSignal?.addEventListener("abort", () => this.controller?.abort(), {
        once: true,
      });
    }
    this.loopPromise = this.run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.controller?.abort();
    this.childSessionIds.clear();
    await this.loopPromise;
  }

  onEvent(handler: (event: SubagentEvent) => void): void {
    this.handlers.push(handler);
  }

  onReconnectRequired(handler: () => Promise<void> | void): void {
    this.reconnectHandlers.push(handler);
  }

  private async run(): Promise<void> {
    let attempt = 0;
    const signal = this.controller?.signal ?? new AbortController().signal;
    while (!this.stopped) {
      if (signal.aborted) return;
      if (await this.consumeStream(signal)) return;
      if (await this.resyncAfterDisconnect(signal)) return;
      if (await this.waitBeforeReconnect(attempt, signal)) return;
      attempt += 1;
    }
  }

  private async consumeStream(signal: AbortSignal): Promise<boolean> {
    try {
      const { stream } = await this.deps.subscribe(signal, buildSseHeaders(this.deps.auth));
      if (this.stopped || signal.aborted) return true;
      for await (const event of stream) {
        if (this.stopped) return true;
        this.mapEvent(event);
      }
      return false;
    } catch (error) {
      if (this.stopped || isAbortError(error)) return true;
      this.deps.logger.warn(`[subagent] SSE stream error: ${sanitizeError(error)}`);
      return false;
    }
  }

  private async resyncAfterDisconnect(signal: AbortSignal): Promise<boolean> {
    for (const handler of this.reconnectHandlers) {
      try {
        await handler();
      } catch (error) {
        this.deps.logger.warn(`[subagent] reconnect handler failed: ${sanitizeError(error)}`);
        return false;
      }
    }
    if (this.stopped) return true;
    try {
      const sessions = await this.deps.listSessions(signal);
      this.childSessionIds.clear();
      for (const session of sessions) {
        if (session.parentID != null) {
          this.childSessionIds.add(session.id);
          this.emit({ type: "subagent.created", session });
        }
      }
    } catch (error) {
      if (this.stopped || isAbortError(error)) return true;
      this.deps.logger.warn(`[subagent] resync list failed: ${sanitizeError(error)}`);
    }
    return this.stopped;
  }

  private async waitBeforeReconnect(attempt: number, signal: AbortSignal): Promise<boolean> {
    if (this.stopped) return true;
    try {
      await this.deps.sleep(500 * 2 ** Math.min(attempt, 6), signal);
    } catch (error) {
      if (this.stopped || isAbortError(error)) return true;
      this.deps.logger.warn(`[subagent] reconnect delay failed: ${sanitizeError(error)}`);
    }
    return this.stopped;
  }

  private mapEvent(event: unknown): void {
    if (typeof event !== "object" || event === null) return;
    const type = (event as { type?: unknown }).type;
    if (type === "session.created") {
      const session = sessionFromEvent(event);
      if (session !== undefined) {
        this.childSessionIds.add(session.id);
        this.emit({ type: "subagent.created", session });
      }
      return;
    }
    if (type === "session.deleted") {
      const session = sessionFromEvent(event);
      if (session !== undefined) {
        this.childSessionIds.delete(session.id);
        this.emit({ type: "subagent.deleted", sessionId: session.id });
      }
      return;
    }
    const sessionId = sessionIdFromEvent(event);
    if (type === "session.idle" && sessionId !== undefined && this.childSessionIds.has(sessionId)) {
      this.emit({ type: "subagent.idle", sessionId });
    } else if (type === "session.error") {
      if (sessionId === undefined)
        this.deps.logger.error("[subagent] session.error without sessionID");
      else if (this.childSessionIds.has(sessionId))
        this.emit({ type: "subagent.error", sessionId });
    }
  }

  private emit(event: SubagentEvent): void {
    for (const handler of this.handlers) handler(event);
  }
}
