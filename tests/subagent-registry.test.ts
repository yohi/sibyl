import { describe, expect, test } from "bun:test";
import { DEFAULT_OBSERVER_CONFIG, type ObserverConfig } from "../src/subagent-config";
import type { NormalizedObserverEvent, ObserverEventSource } from "../src/subagent-event-source";
import { SubagentRegistry, type SubagentRegistryDependencies } from "../src/subagent-registry";
import type {
  HydratedSubagent,
  ObserverParentSnapshot,
  ObserverSnapshotReader,
} from "../src/subagent-snapshot-reader";
import type { SubagentLogger } from "../src/subagent-logger";
import type { SafePartProjection } from "../src/subagent-types";

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

class MemoryObserverEventSource implements ObserverEventSource {
  readonly handlers = new Set<(event: NormalizedObserverEvent) => void>();
  readonly reconnectHandlers = new Set<() => Promise<void> | void>();
  started = false;
  stopped = false;

  start(): void {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  onEvent(handler: (event: NormalizedObserverEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onReconnectRequired(handler: () => Promise<void> | void): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  emit(event: NormalizedObserverEvent): void {
    for (const handler of this.handlers) handler(event);
  }

  async reconnect(): Promise<void> {
    for (const handler of this.reconnectHandlers) await handler();
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function hydratedChild(
  id: string,
  parentSessionId: string,
  status: HydratedSubagent["status"] = "idle",
  updatedAt = 1,
  messages: HydratedSubagent["messages"] = [],
  parts: HydratedSubagent["parts"] = [],
): HydratedSubagent {
  return {
    session: { id, parentSessionId, createdAt: updatedAt, updatedAt },
    status,
    messages,
    parts,
  };
}

function snapshot(
  parentSessionId: string,
  children: readonly HydratedSubagent[],
  omittedCount = 0,
  ignoredSessionIdsSeen: readonly string[] = [],
): ObserverParentSnapshot {
  return { parentSessionId, children, omittedCount, ignoredSessionIdsSeen };
}

function sessionUpsert(
  sessionId: string,
  parentSessionId: string,
  sequence: number,
  updatedAt = sequence,
): NormalizedObserverEvent {
  return {
    type: "session.upsert",
    sequence,
    observedAt: updatedAt,
    session: { id: sessionId, parentSessionId, createdAt: updatedAt, updatedAt },
  };
}

function statusChanged(
  sessionId: string,
  status: "busy" | "idle" | "retry" | "error" | "unknown",
  sequence: number,
): NormalizedObserverEvent {
  return { type: "status.changed", sequence, observedAt: sequence, sessionId, status };
}

function messageRemoved(
  sessionId: string,
  messageId: string,
  sequence: number,
): NormalizedObserverEvent {
  return { type: "message.removed", sequence, observedAt: sequence, sessionId, messageId };
}

function toolPart(
  sessionId: string,
  messageId: string,
  partId: string,
  state: "pending" | "running" | "completed" | "error",
  sequence: number,
): SafePartProjection {
  return {
    kind: "tool",
    sessionId,
    messageId,
    partId,
    activity: { id: partId, toolName: "read", state, updatedAt: sequence },
  };
}

function partUpsert(part: SafePartProjection, sequence: number): NormalizedObserverEvent {
  return { type: "part.upsert", sequence, observedAt: sequence, part };
}

function registryFor(
  input: {
    readonly source?: MemoryObserverEventSource;
    readonly config?: ObserverConfig;
    readonly readParent?: (
      parentSessionId: string,
      config: ObserverConfig,
      signal: AbortSignal,
      ignoredSessionIds?: ReadonlySet<string>,
    ) => Promise<ObserverParentSnapshot>;
    readonly readMessage?: ObserverSnapshotReader["readMessage"];
    readonly now?: () => number;
  } = {},
): { registry: SubagentRegistry; source: MemoryObserverEventSource } {
  const source = input.source ?? new MemoryObserverEventSource();
  const reader: ObserverSnapshotReader = {
    readParent: input.readParent ?? (async (parentSessionId) => snapshot(parentSessionId, [])),
    readMessage: input.readMessage ?? (async () => ({ parts: [] })),
  };
  const dependencies: SubagentRegistryDependencies = {
    eventSource: source,
    snapshotReader: reader,
    config: input.config ?? DEFAULT_OBSERVER_CONFIG,
    logger: new RecordingLogger(),
    now: input.now,
  };
  return { registry: new SubagentRegistry(dependencies), source };
}

describe("SubagentRegistry", () => {
  test("subscribes before hydration and replays buffered events in source order", async () => {
    const source = new MemoryObserverEventSource();
    const hydration = deferred<ObserverParentSnapshot>();
    const { registry } = registryFor({
      source,
      readParent: () => hydration.promise,
    });

    const selecting = registry.selectParent("root");
    expect(source.started).toBe(true);
    source.emit(sessionUpsert("child", "root", 1));
    source.emit(statusChanged("child", "busy", 2));
    hydration.resolve(snapshot("root", [hydratedChild("child", "root", "idle", 1)]));
    await selecting;

    expect(registry.snapshot()).toMatchObject({
      parentSessionId: "root",
      ready: true,
      views: [{ sessionId: "child", status: "busy" }],
    });
  });

  test("replays status changes and message removals that arrive during resync", async () => {
    const source = new MemoryObserverEventSource();
    const resyncRead = deferred<ObserverParentSnapshot>();
    let readCount = 0;
    const childWithMessage = hydratedChild("child-message", "root", "busy", 2, [
      {
        id: "assistant-1",
        sessionId: "child-message",
        role: "assistant",
        createdAt: 2,
        providerId: "openai",
        modelId: "gpt-5.6",
        hasError: false,
      },
    ]);
    const { registry } = registryFor({
      source,
      readParent: async () => {
        readCount += 1;
        return readCount === 1
          ? snapshot("root", [hydratedChild("child-update", "root", "idle", 1), childWithMessage])
          : resyncRead.promise;
      },
    });

    await registry.selectParent("root");
    const resyncing = registry.resyncNow();
    await Promise.resolve();
    expect(readCount).toBe(2);
    source.emit(statusChanged("child-update", "busy", 10));
    source.emit(messageRemoved("child-message", "assistant-1", 11));
    resyncRead.resolve(
      snapshot("root", [hydratedChild("child-update", "root", "idle", 1), childWithMessage]),
    );
    await resyncing;

    expect(
      registry.snapshot().views.find((view) => view.sessionId === "child-update"),
    ).toMatchObject({
      status: "busy",
    });
    const childAfterRemoval = registry
      .snapshot()
      .views.find((view) => view.sessionId === "child-message");
    expect(childAfterRemoval).toBeDefined();
    expect(childAfterRemoval).not.toHaveProperty("providerId");
    expect(childAfterRemoval).not.toHaveProperty("modelId");
  });

  test("resets the visible parent and rejects grandchild session updates", async () => {
    const { registry, source } = registryFor({
      readParent: async (parentSessionId) =>
        snapshot(parentSessionId, [hydratedChild(`child-${parentSessionId}`, parentSessionId)]),
    });
    await registry.selectParent("root-a");
    source.emit(sessionUpsert("grandchild", "child-root-a", 1));
    await registry.selectParent("root-b");

    expect(registry.snapshot()).toMatchObject({
      parentSessionId: "root-b",
      views: [{ sessionId: "child-root-b" }],
    });
    expect(registry.snapshot().views.map((view) => view.sessionId)).not.toContain("grandchild");
  });

  test("resolves agent, model, status, and tool transition precedence", async () => {
    const parts: SafePartProjection[] = [
      {
        kind: "subtask",
        sessionId: "child",
        messageId: "assistant-1",
        partId: "subtask-1",
        agent: "librarian",
        observedAt: 1,
      },
      {
        kind: "agent",
        sessionId: "child",
        messageId: "assistant-1",
        partId: "agent-1",
        name: "explore",
        observedAt: 2,
      },
      toolPart("child", "assistant-1", "tool-1", "pending", 3),
    ];
    const { registry, source } = registryFor({
      readParent: async () =>
        snapshot("root", [
          hydratedChild(
            "child",
            "root",
            "idle",
            1,
            [
              {
                id: "user-1",
                sessionId: "child",
                role: "user",
                createdAt: 1,
                agentName: "general",
                providerId: "user-provider",
                modelId: "user-model",
              },
              {
                id: "assistant-1",
                sessionId: "child",
                role: "assistant",
                createdAt: 2,
                providerId: "openai",
                modelId: "gpt-5.6",
                hasError: false,
              },
            ],
            parts,
          ),
        ]),
    });
    await registry.selectParent("root");
    let view = registry.snapshot().views[0];
    expect(view).toMatchObject({
      agentName: "explore",
      providerId: "openai",
      modelId: "gpt-5.6",
      status: "idle",
      currentActivity: { id: "tool-1", state: "pending" },
    });

    source.emit(statusChanged("child", "busy", 10));
    source.emit(partUpsert(toolPart("child", "assistant-1", "tool-1", "running", 11), 11));
    source.emit(partUpsert(toolPart("child", "assistant-1", "tool-1", "completed", 12), 12));
    await Promise.resolve();
    view = registry.snapshot().views[0];
    expect(view.status).toBe("busy");
    expect(view.currentActivity).toBeUndefined();
    expect(view.recentActivity.map((activity) => activity.id)).toEqual(["tool-1"]);
  });

  test("reports initial snapshot omissions and never evicts active entries", async () => {
    const allChildren = Array.from({ length: 9 }, (_, index) =>
      hydratedChild(`child-${index + 1}`, "root", "busy", index + 1),
    );
    const { registry, source } = registryFor({
      config: { ...DEFAULT_OBSERVER_CONFIG, maxTrackedSubagents: 8 },
      readParent: async () => snapshot("root", allChildren.slice(0, 8), 1),
    });
    await registry.selectParent("root");
    source.emit(sessionUpsert("child-9", "root", 10));
    await Promise.resolve();

    expect(registry.snapshot().views).toHaveLength(8);
    expect(registry.snapshot().overflowCount).toBe(2);
    expect(registry.snapshot().views.map((view) => view.sessionId)).toEqual(
      allChildren
        .slice(0, 8)
        .reverse()
        .map((child) => child.session.id),
    );
  });

  test("retains only the configured number of completed activities and coalesces notifications", async () => {
    const { registry, source } = registryFor({
      config: { ...DEFAULT_OBSERVER_CONFIG, activityLimit: 1 },
      readParent: async () => snapshot("root", [hydratedChild("child", "root")]),
    });
    await registry.selectParent("root");
    let notifications = 0;
    const unsubscribe = registry.subscribe(() => {
      notifications += 1;
    });
    for (let index = 0; index < 100; index += 1) {
      source.emit(statusChanged("child", index % 2 === 0 ? "busy" : "idle", index + 1));
    }
    await Promise.resolve();
    expect(notifications).toBe(1);
    unsubscribe();
  });

  test("drops a late message refresh after parent selection changes", async () => {
    const refresh = deferred<{ readonly message?: never; readonly parts: readonly [] }>();
    const { registry, source } = registryFor({
      readParent: async (parentSessionId) =>
        snapshot(parentSessionId, [hydratedChild("child", parentSessionId)]),
      readMessage: async () => refresh.promise,
    });
    await registry.selectParent("root-a");
    source.emit({
      type: "part.refresh",
      sequence: 1,
      observedAt: 1,
      sessionId: "child",
      messageId: "assistant-1",
      partId: "text-1",
    });
    await Promise.resolve();
    await registry.selectParent("root-b");
    refresh.resolve({ parts: [] });
    await Promise.resolve();
    await Promise.resolve();

    expect(registry.snapshot().parentSessionId).toBe("root-b");
    expect(registry.snapshot().views).toEqual([
      expect.objectContaining({ sessionId: "child", parentSessionId: "root-b" }),
    ]);
  });

  test("cleans every source, timer, and map on idempotent stop", async () => {
    const { registry, source } = registryFor({
      readParent: async () => snapshot("root", [hydratedChild("child", "root")]),
    });
    await registry.selectParent("root");
    await registry.stop();
    await registry.stop();

    expect(source.stopped).toBe(true);
    expect(registry.snapshot()).toEqual({ ready: false, views: [], overflowCount: 0 });
    expect(registry.debugCounts()).toEqual({
      trackedChildren: 0,
      pendingChildren: 0,
      messageReferences: 0,
      partReferences: 0,
      inFlightRefreshes: 0,
    });
  });
});
