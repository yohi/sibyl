import { expect, test } from "bun:test";
import { DEFAULT_OBSERVER_CONFIG } from "../src/subagent-config";
import type { NormalizedObserverEvent, ObserverEventSource } from "../src/subagent-event-source";
import { SubagentRegistry } from "../src/subagent-registry";
import { createV2SnapshotReader } from "../src/subagent-v2-snapshot";
import { makeAssistant, makeSession } from "./helpers/opencode-v2";

test("shows the agent and model from a V2 assistant snapshot", async () => {
  const source: ObserverEventSource = {
    start() {},
    async stop() {},
    onEvent() {
      return () => {};
    },
    onReconnectRequired() {
      return () => {};
    },
  };
  const reader = createV2SnapshotReader({
    list: async () => ({ data: [makeSession()], cursor: {} }),
    active: async () => ({ ses_child: { type: "running" } }),
    messages: async () => ({ data: [makeAssistant()], cursor: {} }),
    message: async () => makeAssistant(),
  });
  const registry = new SubagentRegistry({
    eventSource: source,
    snapshotReader: reader,
    config: { ...DEFAULT_OBSERVER_CONFIG, enabled: true },
    logger: { info() {}, warn() {}, error() {} },
  });
  try {
    await registry.selectParent("ses_parent");
    expect(registry.snapshot().views[0]).toMatchObject({
      agentName: "test-agent",
      providerId: "test-provider",
      modelId: "test-model",
      status: "busy",
    });
  } finally {
    await registry.stop();
  }
});

test("retains a safe title category in the displayed child", async () => {
  const source: ObserverEventSource = {
    start() {},
    async stop() {},
    onEvent() {
      return () => {};
    },
    onReconnectRequired() {
      return () => {};
    },
  };
  const reader = createV2SnapshotReader({
    list: async () => ({ data: [makeSession({ title: "[quick] synthetic child" })], cursor: {} }),
    active: async () => ({}),
    messages: async () => ({ data: [] }),
    message: async () => makeAssistant(),
  });
  const registry = new SubagentRegistry({
    eventSource: source,
    snapshotReader: reader,
    config: DEFAULT_OBSERVER_CONFIG,
    logger: { info() {}, warn() {}, error() {} },
  });
  try {
    await registry.selectParent("ses_parent");
    expect(registry.snapshot().views[0]).toMatchObject({ category: "quick" });
  } finally {
    await registry.stop();
  }
});

test("a historical assistant error does not override a successful session", async () => {
  const source: ObserverEventSource = {
    start() {},
    async stop() {},
    onEvent() {
      return () => {};
    },
    onReconnectRequired() {
      return () => {};
    },
  };
  const reader = createV2SnapshotReader({
    list: async () => ({
      data: [makeSession({ outcome: "succeeded", time: { created: 1, updated: 30, idle: 30 } })],
      cursor: {},
    }),
    active: async () => ({}),
    messages: async () => ({
      data: [
        makeAssistant({ id: "msg_recent", time: { created: 20, completed: 25 } }),
        makeAssistant({
          id: "msg_old",
          time: { created: 10, completed: 11 },
          error: { type: "failure", message: "private" },
        }),
      ],
    }),
    message: async () => makeAssistant(),
  });
  const registry = new SubagentRegistry({
    eventSource: source,
    snapshotReader: reader,
    config: DEFAULT_OBSERVER_CONFIG,
    logger: { info() {}, warn() {}, error() {} },
  });
  try {
    await registry.selectParent("ses_parent");
    expect(registry.snapshot().views[0]?.status).toBe("idle");
  } finally {
    await registry.stop();
  }
});

test("does not use an old idle outcome for a newer assistant message", async () => {
  const source: ObserverEventSource = {
    start() {},
    async stop() {},
    onEvent() {
      return () => {};
    },
    onReconnectRequired() {
      return () => {};
    },
  };
  const reader = createV2SnapshotReader({
    list: async () => ({
      data: [makeSession({ outcome: "failed", time: { created: 1, updated: 20, idle: 10 } })],
      cursor: {},
    }),
    active: async () => ({}),
    messages: async () => ({ data: [makeAssistant({ time: { created: 20 } })] }),
    message: async () => makeAssistant(),
  });
  const registry = new SubagentRegistry({
    eventSource: source,
    snapshotReader: reader,
    config: DEFAULT_OBSERVER_CONFIG,
    logger: { info() {}, warn() {}, error() {} },
  });
  try {
    await registry.selectParent("ses_parent");
    expect(registry.snapshot().views[0]?.status).toBe("unknown");
  } finally {
    await registry.stop();
  }
});

test("an authoritative successful idle outcome wins over a prior failed assistant", async () => {
  const source: ObserverEventSource = {
    start() {},
    async stop() {},
    onEvent() {
      return () => {};
    },
    onReconnectRequired() {
      return () => {};
    },
  };
  const reader = createV2SnapshotReader({
    list: async () => ({
      data: [makeSession({ outcome: "succeeded", time: { created: 1, updated: 30, idle: 30 } })],
      cursor: {},
    }),
    active: async () => ({}),
    messages: async () => ({
      data: [
        makeAssistant({ time: { created: 10 }, error: { type: "failure", message: "private" } }),
      ],
    }),
    message: async () => makeAssistant(),
  });
  const registry = new SubagentRegistry({
    eventSource: source,
    snapshotReader: reader,
    config: DEFAULT_OBSERVER_CONFIG,
    logger: { info() {}, warn() {}, error() {} },
  });
  try {
    await registry.selectParent("ses_parent");
    expect(registry.snapshot().views[0]?.status).toBe("idle");
  } finally {
    await registry.stop();
  }
});

test("late refresh of an old error does not change a successful status", async () => {
  let listener: ((event: NormalizedObserverEvent) => void) | undefined;
  const source: ObserverEventSource = {
    start() {},
    async stop() {},
    onEvent(handler) {
      listener = handler;
      return () => {};
    },
    onReconnectRequired() {
      return () => {};
    },
  };
  const reader = createV2SnapshotReader({
    list: async () => ({
      data: [makeSession({ outcome: "succeeded", time: { created: 1, updated: 30, idle: 30 } })],
      cursor: {},
    }),
    active: async () => ({}),
    messages: async () => ({ data: [] }),
    message: async () =>
      makeAssistant({
        id: "msg_old",
        time: { created: 10 },
        error: { type: "failure", message: "private" },
      }),
  });
  const registry = new SubagentRegistry({
    eventSource: source,
    snapshotReader: reader,
    config: DEFAULT_OBSERVER_CONFIG,
    logger: { info() {}, warn() {}, error() {} },
  });
  try {
    await registry.selectParent("ses_parent");
    listener?.({
      type: "part.refresh",
      sessionId: "ses_child",
      messageId: "msg_old",
      partId: "msg_old",
      sequence: 1,
      observedAt: 40,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(registry.snapshot().views[0]?.status).toBe("idle");
  } finally {
    await registry.stop();
  }
});

test("late refresh of a historical error does not fail a newer active run", async () => {
  let listener: ((event: NormalizedObserverEvent) => void) | undefined;
  const source: ObserverEventSource = {
    start() {},
    async stop() {},
    onEvent(handler) {
      listener = handler;
      return () => {};
    },
    onReconnectRequired() {
      return () => {};
    },
  };
  const reader = createV2SnapshotReader({
    list: async () => ({ data: [makeSession()], cursor: {} }),
    active: async () => ({ ses_child: { type: "running" } }),
    messages: async () => ({ data: [] }),
    message: async () =>
      makeAssistant({
        id: "msg_old",
        time: { created: 10 },
        error: { type: "failure", message: "private" },
      }),
  });
  const registry = new SubagentRegistry({
    eventSource: source,
    snapshotReader: reader,
    config: DEFAULT_OBSERVER_CONFIG,
    logger: { info() {}, warn() {}, error() {} },
  });
  try {
    await registry.selectParent("ses_parent");
    listener?.({
      type: "part.refresh",
      sessionId: "ses_child",
      messageId: "msg_old",
      partId: "msg_old",
      sequence: 1,
      observedAt: 40,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(registry.snapshot().views[0]?.status).toBe("busy");
  } finally {
    await registry.stop();
  }
});

test("authoritative V2 content refresh removes stale text and tool activity", async () => {
  const source = new (class implements ObserverEventSource {
    handler: ((event: NormalizedObserverEvent) => void) | undefined;
    start() {}
    async stop() {}
    onEvent(handler: (event: NormalizedObserverEvent) => void) {
      this.handler = handler;
      return () => {};
    }
    onReconnectRequired() {
      return () => {};
    }
    emit(event: NormalizedObserverEvent) {
      this.handler?.(event);
    }
  })();
  let content = [
    {
      type: "tool" as const,
      id: "tool_old",
      name: "read",
      time: { created: 2, completed: 3 },
      state: {
        status: "completed" as const,
        input: {},
        content: [{ type: "text" as const, text: "secret result" }] as [
          { type: "text"; text: string },
        ],
      },
    },
    { type: "text" as const, text: "old assistant text" },
  ];
  const reader = createV2SnapshotReader({
    list: async () => ({
      data: [makeSession({ outcome: "succeeded", time: { created: 1, updated: 4, idle: 4 } })],
      cursor: {},
    }),
    active: async () => ({}),
    messages: async () => ({ data: [makeAssistant({ content })] }),
    message: async () => makeAssistant({ content }),
  });
  const registry = new SubagentRegistry({
    eventSource: source,
    snapshotReader: reader,
    config: DEFAULT_OBSERVER_CONFIG,
    logger: { info() {}, warn() {}, error() {} },
  });
  try {
    await registry.selectParent("ses_parent");
    expect(registry.snapshot().views[0]).toMatchObject({
      latestAssistantText: "old assistant text",
      recentActivity: [{ id: "tool_old" }],
    });
    let updated: (() => void) | undefined;
    const changed = new Promise<void>((resolve) => {
      updated = resolve;
    });
    const unsubscribe = registry.subscribe(() => {
      if (registry.snapshot().views[0]?.latestAssistantText === "new assistant text") updated?.();
    });
    content = [{ type: "text", text: "new assistant text" }];
    source.emit({
      type: "part.refresh",
      sessionId: "ses_child",
      messageId: "msg_assistant",
      partId: "msg_assistant",
      sequence: 1,
      observedAt: 5,
    });
    await changed;
    expect(registry.snapshot().views[0]).toMatchObject({
      latestAssistantText: "new assistant text",
      recentActivity: [],
    });
    unsubscribe();
  } finally {
    await registry.stop();
  }
});
