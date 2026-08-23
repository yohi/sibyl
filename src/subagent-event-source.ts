import { sanitizeError } from "./subagent-logger.js";
import type { SubagentLogger } from "./subagent-logger.js";
import {
  normalizeRuntimeStatus,
  projectMessage,
  projectPart,
  projectSession,
  readPartIdentifiers,
  safeCorrelationId,
} from "./subagent-normalizer.js";
import type {
  ObserverRuntimeStatus,
  SafeMessageProjection,
  SafePartProjection,
  SafeSessionProjection,
} from "./subagent-types.js";

export type NormalizedObserverEvent =
  | {
      readonly type: "session.upsert";
      readonly sequence: number;
      readonly observedAt: number;
      readonly session: SafeSessionProjection;
    }
  | {
      readonly type: "session.deleted";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
    }
  | {
      readonly type: "message.upsert";
      readonly sequence: number;
      readonly observedAt: number;
      readonly message: SafeMessageProjection;
    }
  | {
      readonly type: "message.removed";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
      readonly messageId: string;
    }
  | {
      readonly type: "part.upsert";
      readonly sequence: number;
      readonly observedAt: number;
      readonly part: SafePartProjection;
    }
  | {
      readonly type: "part.refresh";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
      readonly messageId: string;
      readonly partId: string;
    }
  | {
      readonly type: "part.removed";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
      readonly messageId: string;
      readonly partId: string;
    }
  | {
      readonly type: "status.changed";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
      readonly status: ObserverRuntimeStatus;
    }
  | {
      readonly type: "session.idle";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
    }
  | {
      readonly type: "session.error";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
    }
  | {
      readonly type: "session.retry";
      readonly sequence: number;
      readonly observedAt: number;
      readonly sessionId: string;
      readonly attempt: number;
    };

export interface ObserverEventSource {
  start(): void;
  stop(): Promise<void>;
  onEvent(handler: (event: NormalizedObserverEvent) => void): () => void;
  onReconnectRequired(handler: () => Promise<void> | void): () => void;
}

export interface TuiEventBusLike {
  on(type: string, handler: (event: unknown) => void): () => void;
}

export interface TuiEventBusSourceDependencies {
  readonly eventBus: TuiEventBusLike;
  readonly logger: SubagentLogger;
  readonly now?: () => number;
}

export interface SseEventSourceDependencies {
  readonly subscribe: (signal: AbortSignal) => Promise<{ readonly stream: AsyncIterable<unknown> }>;
  readonly logger: SubagentLogger;
  readonly sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
  readonly now?: () => number;
  readonly lifecycleSignal?: AbortSignal;
}

const EVENT_TYPES = [
  "session.created",
  "session.updated",
  "session.deleted",
  "message.updated",
  "message.removed",
  "message.part.updated",
  "message.part.removed",
  "session.status",
  "session.idle",
  "session.error",
  "session.next.retried",
] as const;

type EventRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is EventRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function propertiesOf(value: EventRecord): EventRecord | undefined {
  return isRecord(value.properties) ? value.properties : undefined;
}

function normalizedEvent(
  value: unknown,
  sequence: number,
  observedAt: number,
): NormalizedObserverEvent | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  const properties = propertiesOf(value);
  if (properties === undefined) return undefined;
  const type = value.type;

  if (type === "session.created" || type === "session.updated") {
    const session = projectSession(properties.info);
    return session === undefined
      ? undefined
      : { type: "session.upsert", sequence, observedAt, session };
  }
  if (type === "session.deleted") {
    const sessionId =
      safeCorrelationId(properties.sessionID) ?? projectSession(properties.info)?.id;
    return sessionId === undefined
      ? undefined
      : { type: "session.deleted", sequence, observedAt, sessionId };
  }
  if (type === "message.updated") {
    const message = projectMessage(properties.info);
    return message === undefined
      ? undefined
      : { type: "message.upsert", sequence, observedAt, message };
  }
  if (type === "message.removed") {
    const sessionId = safeCorrelationId(properties.sessionID);
    const messageId = safeCorrelationId(properties.messageID);
    return sessionId === undefined || messageId === undefined
      ? undefined
      : { type: "message.removed", sequence, observedAt, sessionId, messageId };
  }
  if (type === "message.part.updated") {
    const part = properties.part;
    const identifiers = readPartIdentifiers(part);
    if (identifiers === undefined) return undefined;
    const partRecord = isRecord(part) ? part : undefined;
    if (partRecord?.type === "text" || partRecord?.type === "reasoning") {
      return { type: "part.refresh", sequence, observedAt, ...identifiers };
    }
    const projected = projectPart(part, { messageRole: undefined, observedAt });
    return projected === undefined
      ? undefined
      : { type: "part.upsert", sequence, observedAt, part: projected };
  }
  if (type === "message.part.removed") {
    const sessionId = safeCorrelationId(properties.sessionID);
    const messageId = safeCorrelationId(properties.messageID);
    const partId = safeCorrelationId(properties.partID);
    return sessionId === undefined || messageId === undefined || partId === undefined
      ? undefined
      : { type: "part.removed", sequence, observedAt, sessionId, messageId, partId };
  }
  if (type === "session.status") {
    const sessionId = safeCorrelationId(properties.sessionID);
    if (sessionId === undefined) return undefined;
    return {
      type: "status.changed",
      sequence,
      observedAt,
      sessionId,
      status: normalizeRuntimeStatus(properties.status),
    };
  }
  if (type === "session.idle") {
    const sessionId = safeCorrelationId(properties.sessionID);
    return sessionId === undefined
      ? undefined
      : { type: "session.idle", sequence, observedAt, sessionId };
  }
  if (type === "session.error") {
    const sessionId = safeCorrelationId(properties.sessionID);
    return sessionId === undefined
      ? undefined
      : { type: "session.error", sequence, observedAt, sessionId };
  }
  if (type === "session.next.retried") {
    const sessionId = safeCorrelationId(properties.sessionID);
    const attempt = finiteNumber(properties.attempt);
    return sessionId === undefined || attempt === undefined || !Number.isInteger(attempt)
      ? undefined
      : { type: "session.retry", sequence, observedAt, sessionId, attempt };
  }
  return undefined;
}

function eventType(value: unknown): string | undefined {
  return isRecord(value) && typeof value.type === "string" ? value.type : undefined;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

export class TuiEventBusSource implements ObserverEventSource {
  private readonly handlers = new Set<(event: NormalizedObserverEvent) => void>();
  private offFns: Array<() => void> = [];
  private started = false;
  private sequence = 0;

  constructor(private readonly deps: TuiEventBusSourceDependencies) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.offFns = EVENT_TYPES.map((type) =>
      this.deps.eventBus.on(type, (event) => this.receive(type, event)),
    );
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    for (const off of this.offFns) off();
    this.offFns = [];
  }

  onEvent(handler: (event: NormalizedObserverEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onReconnectRequired(_handler: () => Promise<void> | void): () => void {
    return () => {};
  }

  private receive(registeredType: string, event: unknown): void {
    const observedAt = this.deps.now?.() ?? Date.now();
    const normalized = normalizedEvent(
      isRecord(event) && eventType(event) === undefined
        ? { ...event, type: registeredType }
        : event,
      this.sequence + 1,
      observedAt,
    );
    if (normalized === undefined) {
      if (registeredType === "session.error") {
        this.deps.logger.warn("[subagent] session.error without sessionID");
      }
      return;
    }
    this.sequence = normalized.sequence;
    for (const handler of this.handlers) handler(normalized);
  }
}

export class SseEventSource implements ObserverEventSource {
  private readonly handlers = new Set<(event: NormalizedObserverEvent) => void>();
  private readonly reconnectHandlers = new Set<() => Promise<void> | void>();
  private started = false;
  private sequence = 0;
  private controller: AbortController | undefined;
  private loopPromise: Promise<void> | undefined;
  private lifecycleCleanup: (() => void) | undefined;

  constructor(private readonly deps: SseEventSourceDependencies) {}

  start(): void {
    if (this.started) return;
    this.controller = new AbortController();
    if (this.deps.lifecycleSignal?.aborted) {
      this.controller.abort();
      return;
    }
    this.started = true;
    const lifecycleSignal = this.deps.lifecycleSignal;
    if (lifecycleSignal !== undefined) {
      const abort = () => this.controller?.abort();
      lifecycleSignal.addEventListener("abort", abort, { once: true });
      this.lifecycleCleanup = () => lifecycleSignal.removeEventListener("abort", abort);
    }
    this.loopPromise = this.run(this.controller.signal);
  }

  async stop(): Promise<void> {
    this.started = false;
    this.controller?.abort();
    this.lifecycleCleanup?.();
    this.lifecycleCleanup = undefined;
    const loopPromise = this.loopPromise;
    if (loopPromise !== undefined) await loopPromise;
    this.loopPromise = undefined;
  }

  onEvent(handler: (event: NormalizedObserverEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onReconnectRequired(handler: () => Promise<void> | void): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  private async run(signal: AbortSignal): Promise<void> {
    let attempt = 0;
    while (this.started && !signal.aborted) {
      const shouldStop = await this.consumeStream(signal);
      if (shouldStop || !this.started || signal.aborted) return;
      for (const handler of this.reconnectHandlers) {
        try {
          await handler();
        } catch (error) {
          if (!this.started || signal.aborted || isAbortError(error)) return;
          this.deps.logger.warn(`[subagent] reconnect handler failed: ${sanitizeError(error)}`);
        }
      }
      if (!this.started || signal.aborted) return;
      try {
        await this.deps.sleep(500 * 2 ** Math.min(attempt, 6), signal);
      } catch (error) {
        if (!this.started || signal.aborted || isAbortError(error)) return;
        this.deps.logger.warn(`[subagent] reconnect delay failed: ${sanitizeError(error)}`);
      }
      attempt += 1;
    }
  }

  private async consumeStream(signal: AbortSignal): Promise<boolean> {
    try {
      const result = await this.deps.subscribe(signal);
      if (!this.started || signal.aborted) return true;
      for await (const item of result.stream) {
        if (!this.started || signal.aborted) return true;
        this.receive(item);
      }
      return false;
    } catch (error) {
      if (!this.started || signal.aborted || isAbortError(error)) return true;
      this.deps.logger.warn(`[subagent] SSE stream error: ${sanitizeError(error)}`);
      return false;
    }
  }

  private receive(item: unknown): void {
    const event = isRecord(item) && isRecord(item.payload) ? item.payload : item;
    const observedAt = this.deps.now?.() ?? Date.now();
    const normalized = normalizedEvent(event, this.sequence + 1, observedAt);
    if (normalized === undefined) {
      if (eventType(event) === "session.error") {
        this.deps.logger.warn("[subagent] session.error without sessionID");
      }
      return;
    }
    this.sequence = normalized.sequence;
    for (const handler of this.handlers) handler(normalized);
  }
}
