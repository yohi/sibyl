import { describe, expect, test } from "bun:test";
import { SseEventSource, TuiEventBusSource, buildSseHeaders } from "../src/subagent-event-source";
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

  on(type: string, handler: (event: unknown) => void): () => void {
    this.handlers.set(type, handler);
    return () => this.handlers.delete(type);
  }

  emit(type: string, event: unknown): void {
    this.handlers.get(type)?.(event);
  }
}

async function* emptyStream(): AsyncGenerator<unknown, void, undefined> {}

describe("subagent event sources", () => {
  test("filters root sessions and maps child bus events", async () => {
    // Given
    const bus = new EventBus();
    const received: string[] = [];
    const source = new TuiEventBusSource({ eventBus: bus, logger: new RecordingLogger() });
    source.onEvent((event) => received.push(event.type));

    // When
    source.start();
    bus.emit("session.created", {
      properties: { info: { id: "root", time: { created: 1 } } },
    });
    bus.emit("session.idle", { properties: { sessionID: "root" } });
    bus.emit("session.error", { properties: { sessionID: "root" } });
    bus.emit("session.created", {
      properties: { info: { id: "child", parentID: "root", time: { created: 2 } } },
    });
    await source.stop();

    // Then
    expect(received).toEqual(["subagent.created"]);
  });

  test("maps valid bus events and ignores malformed payloads", async () => {
    const bus = new EventBus();
    const logger = new RecordingLogger();
    const received: string[] = [];
    const source = new TuiEventBusSource({ eventBus: bus, logger });
    source.onEvent((event) => received.push(event.type));

    source.start();
    source.start();
    bus.emit("session.created", {
      properties: { info: { id: "child", parentID: "root", time: { created: 2 } } },
    });
    bus.emit("session.idle", { properties: { sessionID: "child" } });
    bus.emit("session.error", { properties: { sessionID: "child" } });
    bus.emit("session.deleted", {
      properties: { info: { id: "child", parentID: "root", time: { created: 2 } } },
    });
    bus.emit("session.error", { properties: {} });
    bus.emit("session.deleted", { properties: { info: {} } });
    bus.emit("session.idle", { properties: {} });
    bus.emit("session.created", null);
    bus.emit("session.deleted", undefined);
    bus.emit("session.idle", null);
    bus.emit("session.error", undefined);
    await source.stop();
    bus.emit("session.idle", { properties: { sessionID: "after-stop" } });

    expect(received).toEqual([
      "subagent.created",
      "subagent.idle",
      "subagent.error",
      "subagent.deleted",
    ]);
    expect(logger.warnings).toEqual([
      "[subagent] session.error without sessionID",
      "[subagent] session.error without sessionID",
    ]);
  });

  test("builds an opaque Basic authorization header", () => {
    // Given / When
    const headers = buildSseHeaders({ username: "alice", password: "secret" });

    // Then
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("alice:secret").toString("base64")}`);
    expect(JSON.stringify(headers)).not.toContain("secret");
  });

  test("applies authentication headers to SSE subscriptions", async () => {
    let receivedHeaders: Record<string, string> | undefined;
    const source = new SseEventSource({
      subscribe: async (_signal, headers) => {
        receivedHeaders = headers;
        return { stream: emptyStream() };
      },
      listSessions: async () => [],
      auth: { username: "alice", password: "secret" },
      logger: new RecordingLogger(),
      sleep: async (_delay, signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
      },
    });

    source.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await source.stop();

    expect(receivedHeaders).toEqual({
      Authorization: `Basic ${Buffer.from("alice:secret").toString("base64")}`,
    });
  });

  test("notifies and resyncs before waiting to reconnect", async () => {
    // Given
    let sleepStarted = false;
    const received: string[] = [];
    let reconnects = 0;
    const source = new SseEventSource({
      subscribe: async () => ({ stream: emptyStream() }),
      listSessions: async () => [{ id: "child", parentID: "root", time: { created: 1 } }],
      auth: {},
      logger: new RecordingLogger(),
      sleep: async (_delay, signal) => {
        sleepStarted = true;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
      },
    });
    source.onEvent((event) => received.push(event.type));
    source.onReconnectRequired(() => {
      reconnects += 1;
    });

    // When
    source.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Then
    expect(reconnects).toBe(1);
    expect(received).toEqual(["subagent.created"]);
    expect(sleepStarted).toBe(true);
    await source.stop();
  });

  test("records reconnect handler failures and continues through backoff", async () => {
    const logger = new RecordingLogger();
    let sleepStarted = false;
    const source = new SseEventSource({
      subscribe: async () => ({ stream: emptyStream() }),
      listSessions: async () => [],
      auth: {},
      logger,
      sleep: async (_delay, signal) => {
        sleepStarted = true;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
      },
    });
    source.onReconnectRequired(() => Promise.reject(new Error("handler token=secret failed")));

    source.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sleepStarted).toBe(true);
    expect(logger.warnings).toEqual([
      "[subagent] reconnect handler failed: handler token=[redacted] failed",
    ]);
    await source.stop();
  });

  test("aborts a pending SSE subscription without retrying on normal shutdown", async () => {
    // Given
    let receivedSignal: AbortSignal | undefined;
    const logger = new RecordingLogger();
    const source = new SseEventSource({
      subscribe: async (signal) => {
        receivedSignal = signal;
        return {
          stream: (async function* (): AsyncGenerator<unknown, void, undefined> {
            await new Promise<void>((resolve) =>
              signal.addEventListener("abort", resolve, { once: true }),
            );
            throw new DOMException("cancelled", "AbortError");
          })(),
        };
      },
      listSessions: async () => [],
      auth: {},
      logger,
      sleep: async () => {},
    });

    // When
    source.start();
    await Promise.resolve();
    await source.stop();

    // Then
    expect(receivedSignal?.aborted).toBe(true);
    expect(logger.warnings).toEqual([]);
  });

  test("logs stream, resync, and reconnect delay failures", async () => {
    const logger = new RecordingLogger();
    let firstSleep = true;
    let sleepSignal: AbortSignal | undefined;
    const source = new SseEventSource({
      subscribe: async () => {
        throw new Error("stream failed");
      },
      listSessions: async () => {
        throw new Error("resync failed");
      },
      auth: {},
      logger,
      sleep: async (_delay, signal) => {
        if (firstSleep) {
          firstSleep = false;
          throw new Error("delay failed");
        }
        sleepSignal = signal;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
      },
    });

    source.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await source.stop();

    expect(logger.warnings).toEqual([
      "[subagent] SSE stream error: stream failed",
      "[subagent] resync list failed: resync failed",
      "[subagent] reconnect delay failed: delay failed",
      "[subagent] SSE stream error: stream failed",
      "[subagent] resync list failed: resync failed",
    ]);
    expect(sleepSignal?.aborted).toBe(true);
  });

  test("maps SSE events and resyncs only child sessions", async () => {
    const logger = new RecordingLogger();
    const received: string[] = [];
    const source = new SseEventSource({
      subscribe: async () => ({
        stream: (async function* (): AsyncGenerator<unknown, void, undefined> {
          yield {
            type: "session.created",
            properties: { info: { id: "child", parentID: "root", time: { created: 1 } } },
          };
          yield {
            type: "session.idle",
            properties: { sessionID: "child" },
          };
          yield {
            type: "session.error",
            properties: { sessionID: "child" },
          };
          yield {
            type: "session.deleted",
            properties: { info: { id: "child", parentID: "root", time: { created: 1 } } },
          };
          yield { type: "session.error", properties: {} };
          yield {
            type: "session.created",
            properties: { info: { id: "root", time: { created: 2 } } },
          };
          yield { type: "session.idle", properties: { sessionID: "root" } };
          yield { type: "session.error", properties: { sessionID: "root" } };
          yield null;
          yield { type: "unknown" };
        })(),
      }),
      listSessions: async () => [],
      auth: {},
      logger,
      sleep: async (_delay, signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
      },
    });
    source.onEvent((event) => received.push(event.type));

    source.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await source.stop();

    expect(received).toEqual([
      "subagent.created",
      "subagent.idle",
      "subagent.error",
      "subagent.deleted",
    ]);
    expect(logger.warnings).toEqual(["[subagent] session.error without sessionID"]);
  });

  test("stops immediately when the lifecycle is already aborted", async () => {
    const lifecycle = new AbortController();
    lifecycle.abort();
    let subscribed = false;
    const source = new SseEventSource({
      subscribe: async () => {
        subscribed = true;
        return { stream: emptyStream() };
      },
      listSessions: async () => [],
      auth: {},
      logger: new RecordingLogger(),
      sleep: async () => {},
      lifecycleSignal: lifecycle.signal,
    });

    source.start();
    await source.stop();

    expect(subscribed).toBe(false);
  });

  test("does not consume a stream resolved after shutdown", async () => {
    const logger = new RecordingLogger();
    const source = new SseEventSource({
      subscribe: async () => ({
        stream: {
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                throw new Error("stream should not be consumed after shutdown");
              },
            };
          },
        },
      }),
      listSessions: async () => [],
      auth: {},
      logger,
      sleep: async () => {},
    });

    source.start();
    await source.stop();

    expect(logger.warnings).toEqual([]);
  });
});
