import { describe, expect, test } from "bun:test";
import { SseEventSource, TuiEventBusSource } from "../src/subagent-event-source";
import type { NormalizedObserverEvent } from "../src/subagent-event-source";
import type { SubagentLogger } from "../src/subagent-logger";

class RecordingLogger implements SubagentLogger {
  readonly warnings: string[] = [];

  info(_message: string): void {}

  warn(message: string): void {
    this.warnings.push(message);
  }

  error(message: string): void {
    this.warnings.push(message);
  }
}

class EventBus {
  private readonly handlers = new Map<string, (event: unknown) => void>();
  subscriptions = 0;

  on(type: string, handler: (event: unknown) => void): () => void {
    this.subscriptions += 1;
    this.handlers.set(type, handler);
    return () => this.handlers.delete(type);
  }

  emit(type: string, event: unknown): void {
    this.handlers.get(type)?.(event);
  }
}

function sessionInfo(id: string, parentID = "root") {
  return { id, parentID, time: { created: 10, updated: 20 }, title: "private" };
}

function assistantInfo(id = "assistant-1") {
  return {
    id,
    sessionID: "child",
    role: "assistant",
    time: { created: 10, completed: 20 },
    providerID: "openai",
    modelID: "gpt-5.6",
  };
}

function toolPart() {
  return {
    id: "part-1",
    sessionID: "child",
    messageID: "assistant-1",
    type: "tool",
    callID: "call-1",
    tool: "read",
    state: { status: "running", time: { start: 30 } },
  };
}

function settleAsyncEvents(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("subagent event sources", () => {
  test("normalizes the complete EventBus event matrix", () => {
    const bus = new EventBus();
    const received: NormalizedObserverEvent[] = [];
    const source = new TuiEventBusSource({
      eventBus: bus,
      logger: new RecordingLogger(),
      now: () => 50,
    });
    source.onEvent((event) => received.push(event));
    source.start();

    bus.emit("session.created", {
      type: "session.created",
      properties: { info: sessionInfo("child") },
    });
    bus.emit("session.updated", {
      type: "session.updated",
      properties: { info: sessionInfo("child") },
    });
    bus.emit("session.deleted", { type: "session.deleted", properties: { sessionID: "child" } });
    bus.emit("message.updated", {
      type: "message.updated",
      properties: { sessionID: "child", info: assistantInfo() },
    });
    bus.emit("message.removed", {
      type: "message.removed",
      properties: { sessionID: "child", messageID: "assistant-1" },
    });
    bus.emit("message.part.updated", {
      type: "message.part.updated",
      properties: { sessionID: "child", part: toolPart(), time: 30 },
    });
    bus.emit("message.part.removed", {
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: "assistant-1", partID: "part-1" },
    });
    bus.emit("session.status", {
      type: "session.status",
      properties: { sessionID: "child", status: { type: "busy" } },
    });
    bus.emit("session.idle", { type: "session.idle", properties: { sessionID: "child" } });
    bus.emit("session.error", { type: "session.error", properties: { sessionID: "child" } });
    bus.emit("session.next.retried", {
      type: "session.next.retried",
      properties: { sessionID: "child", attempt: 2, timestamp: 50 },
    });

    expect(received.map((event) => event.type)).toEqual([
      "session.upsert",
      "session.upsert",
      "session.deleted",
      "message.upsert",
      "message.removed",
      "part.upsert",
      "part.removed",
      "status.changed",
      "session.idle",
      "session.error",
      "session.retry",
    ]);
    expect(received.map((event) => event.sequence)).toEqual(
      Array.from({ length: 11 }, (_, index) => index + 1),
    );
    expect(received[5]).toMatchObject({
      type: "part.upsert",
      part: { kind: "tool", activity: { state: "running" } },
    });
    source.stop();
  });

  test("refreshes text and reasoning until message role is known", () => {
    const bus = new EventBus();
    const received: NormalizedObserverEvent[] = [];
    const source = new TuiEventBusSource({
      eventBus: bus,
      logger: new RecordingLogger(),
      now: () => 50,
    });
    source.onEvent((event) => received.push(event));
    source.start();

    bus.emit("message.part.updated", {
      properties: {
        sessionID: "child",
        part: {
          id: "text-1",
          sessionID: "child",
          messageID: "user-1",
          type: "text",
          text: "must not be speculatively retained",
        },
      },
    });
    bus.emit("message.part.updated", {
      properties: {
        sessionID: "child",
        part: {
          id: "reasoning-1",
          sessionID: "child",
          messageID: "assistant-1",
          type: "reasoning",
          text: "raw reasoning",
        },
      },
    });

    expect(received).toEqual([
      {
        type: "part.refresh",
        sequence: 1,
        observedAt: 50,
        sessionId: "child",
        messageId: "user-1",
        partId: "text-1",
      },
      {
        type: "part.refresh",
        sequence: 2,
        observedAt: 50,
        sessionId: "child",
        messageId: "assistant-1",
        partId: "reasoning-1",
      },
    ]);
    source.stop();
  });

  test("does not duplicate EventBus subscriptions when started twice and logs only static malformed errors", async () => {
    const bus = new EventBus();
    const logger = new RecordingLogger();
    const source = new TuiEventBusSource({ eventBus: bus, logger });
    source.start();
    source.start();
    bus.emit("session.error", { properties: { error: "token=secret" } });
    await source.stop();

    expect(bus.subscriptions).toBe(11);
    expect(logger.warnings).toEqual(["[subagent] session.error without sessionID"]);
  });

  test("unwraps SDK GlobalEvent envelopes and preserves source order", async () => {
    const received: NormalizedObserverEvent[] = [];
    const source = new SseEventSource({
      subscribe: async () => ({
        stream: (async function* () {
          yield {
            directory: "/repo",
            payload: { type: "session.created", properties: { info: sessionInfo("child") } },
          };
          yield {
            directory: "/repo",
            payload: {
              type: "session.status",
              properties: { sessionID: "child", status: { type: "busy" } },
            },
          };
          yield {
            directory: "/repo",
            payload: {
              type: "session.next.retried",
              properties: { sessionID: "child", attempt: 2 },
            },
          };
        })(),
      }),
      logger: new RecordingLogger(),
      sleep: async (_delay, signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
      },
      now: () => 50,
    });
    source.onEvent((event) => received.push(event));
    source.start();
    await settleAsyncEvents();
    await source.stop();

    expect(received.map((event) => [event.sequence, event.type])).toEqual([
      [1, "session.upsert"],
      [2, "status.changed"],
      [3, "session.retry"],
    ]);
  });

  test("runs reconnect handlers before backoff after stream completion", async () => {
    let reconnects = 0;
    let sleeping = false;
    const source = new SseEventSource({
      subscribe: async () => ({ stream: (async function* () {})() }),
      logger: new RecordingLogger(),
      sleep: async (_delay, signal) => {
        sleeping = true;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
      },
    });
    source.onReconnectRequired(() => {
      reconnects += 1;
    });
    source.start();
    await settleAsyncEvents();

    expect(reconnects).toBe(1);
    expect(sleeping).toBe(true);
    await source.stop();
  });

  test("aborts a pending subscription without retry warnings", async () => {
    let receivedSignal: AbortSignal | undefined;
    const logger = new RecordingLogger();
    const source = new SseEventSource({
      subscribe: async (signal) => {
        receivedSignal = signal;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
        throw new DOMException("cancelled", "AbortError");
      },
      logger,
      sleep: async () => {},
    });
    source.start();
    await Promise.resolve();
    await source.stop();

    expect(receivedSignal?.aborted).toBe(true);
    expect(logger.warnings).toEqual([]);
  });
});
