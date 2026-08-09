import { describe, expect, test } from "bun:test";
import type { SubagentConfig } from "../src/subagent-config";
import type { SubagentEvent, SubagentEventSource } from "../src/subagent-event-source";
import { SubagentLifecycleManager } from "../src/subagent-lifecycle-manager";
import type { SubagentLogger } from "../src/subagent-logger";
import type {
  AttachTarget,
  SubagentLikeSession,
  SubagentPaneManager,
  SubagentSessionClient,
} from "../src/subagent-types";

class MemorySource implements SubagentEventSource {
  private readonly handlers: ((event: SubagentEvent) => void)[] = [];
  private readonly reconnectHandlers: (() => void)[] = [];
  started = false;

  start(): void {
    this.started = true;
  }

  async stop(): Promise<void> {}

  onEvent(handler: (event: SubagentEvent) => void): void {
    this.handlers.push(handler);
  }

  onReconnectRequired(handler: () => void): void {
    this.reconnectHandlers.push(handler);
  }

  emit(event: SubagentEvent): void {
    for (const handler of this.handlers) handler(event);
  }

  reconnect(): void {
    for (const handler of this.reconnectHandlers) handler();
  }
}

class MemoryPaneManager implements SubagentPaneManager {
  readonly opened: AttachTarget[] = [];
  readonly closed: string[] = [];
  readonly openIds = new Set<string>();
  failingCloseId: string | undefined;

  async open(target: AttachTarget): Promise<void> {
    this.opened.push(target);
    this.openIds.add(target.sessionId);
  }

  async close(sessionId: string): Promise<void> {
    this.closed.push(sessionId);
    this.openIds.delete(sessionId);
    if (sessionId === this.failingCloseId) throw new Error("close failed");
  }

  listOpen(): string[] {
    return [...this.openIds];
  }
}

class MutableSessionClient implements SubagentSessionClient {
  sessions: SubagentLikeSession[];

  constructor(sessions: SubagentLikeSession[]) {
    this.sessions = sessions;
  }

  async list(): Promise<SubagentLikeSession[]> {
    return this.sessions;
  }
}

class OutOfOrderSessionClient implements SubagentSessionClient {
  private callCount = 0;
  private firstResyncResolve: ((sessions: readonly SubagentLikeSession[]) => void) | undefined;

  async list(): Promise<readonly SubagentLikeSession[]> {
    this.callCount += 1;
    if (this.callCount === 1) return [child("gone", 1)];
    if (this.callCount === 2) {
      return new Promise((resolve) => {
        this.firstResyncResolve = resolve;
      });
    }
    return [];
  }

  resolveFirstResync(sessions: readonly SubagentLikeSession[]): void {
    this.firstResyncResolve?.(sessions);
  }
}

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

function child(id: string, created: number): SubagentLikeSession {
  return { id, parentID: "root", time: { created } };
}

function managerFor(
  config: SubagentConfig,
  paneManager: MemoryPaneManager,
  client: MutableSessionClient,
  source = new MemorySource(),
): { readonly manager: SubagentLifecycleManager; readonly source: MemorySource } {
  return {
    manager: new SubagentLifecycleManager({
      paneManager,
      eventSource: source,
      sessionClient: client,
      config,
      logger: new RecordingLogger(),
    }),
    source,
  };
}

describe("subagent lifecycle manager", () => {
  test("closes every existing pane when maxPanes is zero even when display is disabled", async () => {
    // Given
    const pane = new MemoryPaneManager();
    await pane.open({ sessionId: "pre-existing", createdAt: 1 });
    const { manager } = managerFor(
      { enabled: false, maxPanes: 0 },
      pane,
      new MutableSessionClient([]),
    );

    // When
    await manager.start();

    // Then
    expect(pane.closed).toEqual(["pre-existing"]);
  });

  test("serializes startup resync and duplicate create events", async () => {
    // Given
    const pane = new MemoryPaneManager();
    const client = new MutableSessionClient([child("first", 1)]);
    const { manager, source } = managerFor({ enabled: true, maxPanes: 2 }, pane, client);

    // When
    await manager.start();
    source.emit({ type: "subagent.created", session: child("first", 1) });
    await manager.resyncNow();

    // Then
    expect(source.started).toBe(true);
    expect(pane.opened).toEqual([{ sessionId: "first", createdAt: 1 }]);
  });

  test("does not apply an older resync after a newer resync", async () => {
    // Given
    const pane = new MemoryPaneManager();
    const client = new OutOfOrderSessionClient();
    const { manager } = managerFor({ enabled: true, maxPanes: 2 }, pane, client);
    await manager.start();

    // When
    const firstResync = manager.resyncNow();
    const secondResync = manager.resyncNow();
    await Promise.resolve();
    client.resolveFirstResync([child("gone", 1)]);
    await Promise.all([firstResync, secondResync]);

    // Then
    expect(pane.opened).toEqual([{ sessionId: "gone", createdAt: 1 }]);
    expect(pane.closed).toEqual(["gone"]);
    expect(pane.listOpen()).toEqual([]);
  });

  test("closes an orphaned pane during initial resync", async () => {
    // Given
    const pane = new MemoryPaneManager();
    await pane.open({ sessionId: "orphan", createdAt: 1 });
    const { manager } = managerFor(
      { enabled: true, maxPanes: 2 },
      pane,
      new MutableSessionClient([]),
    );

    // When
    await manager.start();

    // Then
    expect(pane.closed).toEqual(["orphan"]);
    expect(pane.listOpen()).toEqual([]);
  });

  test("evicts the oldest pane before opening a new one", async () => {
    // Given
    const pane = new MemoryPaneManager();
    const client = new MutableSessionClient([child("first", 1), child("second", 2)]);
    const { manager } = managerFor({ enabled: true, maxPanes: 1 }, pane, client);

    // When
    await manager.start();

    // Then
    expect(pane.closed).toEqual(["first"]);
    expect(pane.listOpen()).toEqual(["second"]);
  });

  test("attempts each pane cleanup independently during stop", async () => {
    // Given
    const pane = new MemoryPaneManager();
    const client = new MutableSessionClient([child("first", 1), child("second", 2)]);
    const { manager } = managerFor({ enabled: true, maxPanes: 2 }, pane, client);
    await manager.start();
    pane.failingCloseId = "first";

    // When
    await manager.stop();

    // Then
    expect(pane.closed).toContain("first");
    expect(pane.closed).toContain("second");
  });
});
