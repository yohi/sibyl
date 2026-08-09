import { sanitizeError } from "./subagent-logger.js";
import type { SubagentLogger } from "./subagent-logger.js";
import type { SubagentLikeSession } from "./subagent-types.js";

export type SubagentEvent =
  | { type: "subagent.created"; session: SubagentLikeSession }
  | { type: "subagent.idle"; sessionId: string }
  | { type: "subagent.error"; sessionId?: string | undefined }
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
  const info = (event as { properties?: { info?: unknown } }).properties?.info;
  if (typeof info !== "object" || info === null) return undefined;
  const value = info as { id?: unknown; parentID?: unknown; time?: { created?: unknown } };
  if (typeof value.id !== "string" || typeof value.time?.created !== "number") return undefined;
  if (typeof value.parentID !== "string") return undefined;
  return { id: value.id, parentID: value.parentID, time: { created: value.time.created } };
}

function sessionIdFromEvent(event: unknown): string | undefined {
  const value = (event as { properties?: { sessionID?: unknown } }).properties?.sessionID;
  return typeof value === "string" ? value : undefined;
}

export class TuiEventBusSource implements SubagentEventSource {
  private readonly handlers: Array<(event: SubagentEvent) => void> = [];
  private offFns: Array<() => void> = [];

  constructor(private readonly deps: { eventBus: TuiEventBusLike; logger: SubagentLogger }) {}

  start(): void {
    if (this.offFns.length > 0) return;
    const { eventBus } = this.deps;
    this.offFns = [
      eventBus.on("session.created", (event) => {
        const session = sessionFromEvent(event);
        if (session !== undefined) this.emit({ type: "subagent.created", session });
      }),
      eventBus.on("session.deleted", (event) => {
        const session = sessionFromEvent(event);
        if (session !== undefined) this.emit({ type: "subagent.deleted", sessionId: session.id });
      }),
      eventBus.on("session.idle", (event) => {
        const sessionId = sessionIdFromEvent(event);
        if (sessionId !== undefined) this.emit({ type: "subagent.idle", sessionId });
      }),
      eventBus.on("session.error", (event) => {
        const sessionId = sessionIdFromEvent(event);
        if (sessionId === undefined) {
          this.deps.logger.error("[subagent] session.error without sessionID");
          return;
        }
        this.emit({ type: "subagent.error", sessionId });
      }),
    ];
  }

  async stop(): Promise<void> {
    for (const off of this.offFns) off();
    this.offFns = [];
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
  username?: string | undefined;
  password?: string | undefined;
}): Record<string, string> {
  if (auth.password === undefined) return {};
  return {
    Authorization: `Basic ${Buffer.from(`${auth.username ?? ""}:${auth.password}`).toString("base64")}`,
  };
}

export interface SseDeps {
  subscribe(signal: AbortSignal): Promise<{ stream: AsyncIterable<unknown> }>;
  listSessions(signal: AbortSignal): Promise<readonly SubagentLikeSession[]>;
  auth: { username?: string | undefined; password?: string | undefined };
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
  private stopped = true;
  private loopPromise: Promise<void> | undefined;
  private controller: AbortController | undefined;

  constructor(private readonly deps: SseDeps) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.controller = new AbortController();
    if (this.deps.lifecycleSignal?.aborted) this.controller.abort();
    else {
      this.deps.lifecycleSignal?.addEventListener("abort", () => this.controller?.abort(), {
        once: true,
      });
    }
    this.loopPromise = this.run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.controller?.abort();
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
      try {
        const { stream } = await this.deps.subscribe(signal);
        attempt = 0;
        for await (const event of stream) {
          if (this.stopped) return;
          this.mapEvent(event);
        }
      } catch (error) {
        if (this.stopped || isAbortError(error)) return;
        this.deps.logger.warn(`[subagent] SSE stream error: ${sanitizeError(error)}`);
      }
      if (this.stopped) return;
      for (const handler of this.reconnectHandlers) await handler();
      if (this.stopped) return;
      try {
        const sessions = await this.deps.listSessions(signal);
        for (const session of sessions) {
          if (session.parentID != null) this.emit({ type: "subagent.created", session });
        }
      } catch (error) {
        if (this.stopped || isAbortError(error)) return;
        this.deps.logger.warn(`[subagent] resync list failed: ${sanitizeError(error)}`);
      }
      if (this.stopped) return;
      try {
        await this.deps.sleep(500 * 2 ** Math.min(attempt, 6), signal);
      } catch (error) {
        if (this.stopped || isAbortError(error)) return;
        this.deps.logger.warn(`[subagent] reconnect delay failed: ${sanitizeError(error)}`);
      }
      attempt += 1;
    }
  }

  private mapEvent(event: unknown): void {
    const type = (event as { type?: unknown }).type;
    if (type === "session.created") {
      const session = sessionFromEvent(event);
      if (session !== undefined) this.emit({ type: "subagent.created", session });
      return;
    }
    if (type === "session.deleted") {
      const session = sessionFromEvent(event);
      if (session !== undefined) this.emit({ type: "subagent.deleted", sessionId: session.id });
      return;
    }
    const sessionId = sessionIdFromEvent(event);
    if (type === "session.idle" && sessionId !== undefined) {
      this.emit({ type: "subagent.idle", sessionId });
    } else if (type === "session.error") {
      if (sessionId === undefined)
        this.deps.logger.error("[subagent] session.error without sessionID");
      else this.emit({ type: "subagent.error", sessionId });
    }
  }

  private emit(event: SubagentEvent): void {
    for (const handler of this.handlers) handler(event);
  }
}
