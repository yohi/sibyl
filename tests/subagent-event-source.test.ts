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
    bus.emit("session.created", {
      properties: { info: { id: "child", parentID: "root", time: { created: 2 } } },
    });
    await source.stop();

    // Then
    expect(received).toEqual(["subagent.created"]);
  });

  test("builds an opaque Basic authorization header", () => {
    // Given / When
    const headers = buildSseHeaders({ username: "alice", password: "secret" });

    // Then
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("alice:secret").toString("base64")}`);
    expect(JSON.stringify(headers)).not.toContain("secret");
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
});
