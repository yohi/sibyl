import type { Plugin } from "@opencode/plugin/tui";
import type { NormalizedObserverEvent, ObserverEventSource } from "./subagent-event-source.js";
import { normalizeRuntimeStatus, safeCorrelationId } from "./subagent-normalizer.js";
import { consoleSubagentLogger } from "./subagent-logger.js";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class V2EventSource implements ObserverEventSource {
  private readonly handlers = new Set<(event: NormalizedObserverEvent) => void>();
  private readonly resyncHandlers = new Set<() => Promise<void> | void>();
  private unsubscribe: (() => void) | undefined;
  private sequence = 0;

  constructor(private readonly data: Pick<Plugin.Context["data"], "listen">) {}

  start(): void {
    if (this.unsubscribe !== undefined) return;
    this.unsubscribe = this.data.listen(({ details }) => {
      const event = normalizeV2ObserverEvent(details, this.sequence + 1, Date.now());
      if (event) {
        this.sequence = event.sequence;
        for (const handler of this.handlers) handler(event);
      }
      if (
        details.type === "session.created" ||
        details.type === "session.moved" ||
        details.type === "session.forked" ||
        details.type === "session.revert.committed"
      ) {
        for (const handler of this.resyncHandlers) {
          void Promise.resolve()
            .then(handler)
            .catch(() => {
              consoleSubagentLogger.warn("[subagent] V2 resynchronization failed");
            });
        }
      }
    });
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  onEvent(handler: (event: NormalizedObserverEvent) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  onReconnectRequired(handler: () => Promise<void> | void): () => void {
    this.resyncHandlers.add(handler);
    return () => {
      this.resyncHandlers.delete(handler);
    };
  }
}

export function normalizeV2ObserverEvent(
  event: unknown,
  sequence: number,
  observedAt: number,
): NormalizedObserverEvent | undefined {
  if (!isRecord(event) || !isRecord(event.data)) return undefined;
  const sessionId = safeCorrelationId(event.data.sessionID);
  if (sessionId === undefined) return undefined;
  const base = { sequence, observedAt, sessionId };
  switch (event.type) {
    case "session.status":
      return { type: "status.changed", ...base, status: normalizeRuntimeStatus(event.data.status) };
    case "session.deleted":
      return { type: "session.deleted", ...base };
    case "session.execution.started":
      return { type: "status.changed", ...base, status: "busy" };
    case "session.execution.succeeded":
    case "session.execution.interrupted":
      return { type: "session.idle", ...base };
    case "session.execution.failed":
      return { type: "session.error", ...base };
    case "session.retry.scheduled": {
      const attempt = event.data.attempt;
      if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 1)
        return undefined;
      return { type: "session.retry", ...base, attempt };
    }
    case "session.step.started":
    case "session.step.ended":
    case "session.step.failed":
    case "session.text.started":
    case "session.text.delta":
    case "session.text.ended":
    case "session.tool.input.started":
    case "session.tool.called":
    case "session.tool.success":
    case "session.tool.failed": {
      const messageId = safeCorrelationId(event.data.assistantMessageID);
      if (messageId === undefined) return undefined;
      return { type: "part.refresh", ...base, messageId, partId: messageId };
    }
    default:
      break;
  }
  return undefined;
}
