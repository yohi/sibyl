import { describe, expect, test } from "bun:test";
import { createLayoutManagerController } from "../src/layout-manager";
import type { PaneBackend, PaneSpawner, PaneTerminator } from "../src/pane-backend";
import { SubagentPaneAdapter } from "../src/subagent-pane-adapter";
import type { SubagentLogger } from "../src/subagent-logger";
import { FakePtyManager } from "./fake-pty-manager";
import type { PtyHandle, PtyId } from "../src/pty-manager";
import type { PaneModel, PtyOptions } from "../src/types";

class TestBackend implements PaneBackend {
  readonly created: PaneModel[] = [];
  failCreate = false;

  create(options: PtyOptions): PaneModel {
    if (this.failCreate) throw new Error("pane creation failed");
    const pane = { id: `subagent-${this.created.length + 1}`, ptyOptions: options };
    this.created.push(pane);
    return pane;
  }

  spawn(manager: PaneSpawner, options: PtyOptions): Promise<PtyHandle> {
    return manager.spawn(options);
  }

  write(handle: PtyHandle, data: string): void {
    handle.write(data);
  }

  resize(handle: PtyHandle, columns: number, rows: number): void {
    handle.resize(columns, rows);
  }

  terminate(manager: PaneTerminator, id: PtyId): Promise<void> {
    return manager.terminate(id);
  }
}

class FailingTerminationPtyManager extends FakePtyManager {
  private shouldFail = true;

  override async terminate(id: PtyId): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error("termination failed");
    }
    await super.terminate(id);
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

const shellOptions = { command: "sh", args: [] } satisfies PtyOptions;

describe("subagent pane adapter", () => {
  test("transfers a pre-spawned PTY through splitPane without a second spawn", async () => {
    // Given
    const ptyManager = new FakePtyManager();
    const backend = new TestBackend();
    const layout = createLayoutManagerController(
      ptyManager,
      { id: "root", ptyOptions: shellOptions },
      backend,
    );
    const adapter = new SubagentPaneAdapter({
      layout,
      paneBackend: backend,
      ptyManager,
      serverUrl: "https://server.test",
      directory: "/repo",
      logger: new RecordingLogger(),
    });

    // When
    await adapter.open({ sessionId: "ses-123", createdAt: 1 });

    // Then
    const created = backend.created[0];
    expect(created).toBeDefined();
    if (created === undefined) return;
    expect(ptyManager.spawnedOptions).toHaveLength(1);
    expect(layout.getInitialPtyHandle(created.id)?.id).toBe("fake-pty-1");
    await adapter.open({ sessionId: "ses-123", createdAt: 1 });
    expect(ptyManager.spawnedOptions).toHaveLength(1);
  });

  test("does not duplicate a PTY when opening the same session concurrently", async () => {
    // Given
    const ptyManager = new FakePtyManager();
    const backend = new TestBackend();
    const layout = createLayoutManagerController(
      ptyManager,
      { id: "root", ptyOptions: shellOptions },
      backend,
    );
    const adapter = new SubagentPaneAdapter({
      layout,
      paneBackend: backend,
      ptyManager,
      serverUrl: "https://server.test",
      directory: "/repo",
      logger: new RecordingLogger(),
    });

    // When
    await Promise.all([
      adapter.open({ sessionId: "ses-concurrent", createdAt: 1 }),
      adapter.open({ sessionId: "ses-concurrent", createdAt: 1 }),
    ]);

    // Then
    expect(ptyManager.spawnedOptions).toHaveLength(1);
    expect(backend.created).toHaveLength(1);
    await adapter.close("ses-concurrent");
    await adapter.open({ sessionId: "ses-concurrent", createdAt: 1 });
    expect(ptyManager.spawnedOptions).toHaveLength(2);
  });

  test("terminates a pre-spawned PTY when pane creation fails", async () => {
    // Given
    const ptyManager = new FakePtyManager();
    const backend = new TestBackend();
    backend.failCreate = true;
    const layout = createLayoutManagerController(
      ptyManager,
      { id: "root", ptyOptions: shellOptions },
      backend,
    );
    const adapter = new SubagentPaneAdapter({
      layout,
      paneBackend: backend,
      ptyManager,
      serverUrl: "https://server.test",
      directory: "/repo",
      logger: new RecordingLogger(),
    });

    // When
    await adapter.open({ sessionId: "ses-create-failure", createdAt: 1 });

    // Then
    expect(ptyManager.terminatedIds).toEqual(["fake-pty-1"]);
    backend.failCreate = false;
    await adapter.open({ sessionId: "ses-create-failure", createdAt: 1 });
    expect(backend.created).toHaveLength(1);
  });

  test("keeps the session mapping when closing a pane fails", async () => {
    // Given
    const ptyManager = new FailingTerminationPtyManager();
    const backend = new TestBackend();
    const layout = createLayoutManagerController(
      ptyManager,
      { id: "root", ptyOptions: shellOptions },
      backend,
    );
    const adapter = new SubagentPaneAdapter({
      layout,
      paneBackend: backend,
      ptyManager,
      serverUrl: "https://server.test",
      directory: "/repo",
      logger: new RecordingLogger(),
    });
    await adapter.open({ sessionId: "ses-close-retry", createdAt: 1 });

    // When
    await expect(adapter.close("ses-close-retry")).rejects.toThrow("termination failed");

    // Then
    expect(adapter.listOpen()).toEqual(["ses-close-retry"]);
    await adapter.close("ses-close-retry");
    expect(adapter.listOpen()).toEqual([]);
  });

  test("registers initial handle before setting the new pane model", async () => {
    // Given
    const ptyManager = new FakePtyManager();
    const backend = new TestBackend();
    const layout = createLayoutManagerController(
      ptyManager,
      { id: "root", ptyOptions: shellOptions },
      backend,
    );
    const handle = await ptyManager.spawn(shellOptions);

    // When
    layout.splitPane("horizontal", shellOptions, (options) => ({
      model: backend.create(options),
      initialPtyHandle: handle,
    }));

    // Then
    const created = backend.created[0];
    expect(created).toBeDefined();
    if (created === undefined) return;
    expect(layout.getInitialPtyHandle(created.id)).toBe(handle);
  });

  test("contains invalid attach errors without exposing a full session ID", async () => {
    // Given
    const ptyManager = new FakePtyManager();
    const backend = new TestBackend();
    const logger = new RecordingLogger();
    const layout = createLayoutManagerController(
      ptyManager,
      { id: "root", ptyOptions: shellOptions },
      backend,
    );
    const adapter = new SubagentPaneAdapter({
      layout,
      paneBackend: backend,
      ptyManager,
      serverUrl: "https://server.test",
      directory: "/repo",
      logger,
    });

    // When
    await adapter.open({ sessionId: "bad;session", createdAt: 1 });

    // Then
    expect(ptyManager.spawnedOptions).toHaveLength(0);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]?.length).toBeLessThanOrEqual(200);
    expect(logger.warnings[0]).toContain("[redacted]");
    expect(logger.warnings[0]).not.toContain("bad;session");
  });
});
