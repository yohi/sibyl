import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { PaneBackend } from "../src/pane-backend";
import type { PtyHandle, PtyId, PtyManager } from "../src/pty-manager";
import type { PaneModel } from "../src/types";
import { FakePtyManager } from "./fake-pty-manager";

const lifecycle: { cleanups: (() => void)[] } = { cleanups: [] };
const keyboardCallbacks: Array<(event: { readonly name?: string }) => void> = [];
const effectCallbacks: Array<() => void> = [];

beforeEach(() => {
  keyboardCallbacks.length = 0;
  effectCallbacks.length = 0;
  lifecycle.cleanups.length = 0;
});

function isSignalUpdater<T>(next: T | ((previous: T) => T)): next is (previous: T) => T {
  return typeof next === "function";
}

function getCleanup(): (() => void) | undefined {
  return lifecycle.cleanups.at(-1);
}

function createSignal<T>(initial: T) {
  let value = initial;
  return [
    () => value,
    (next: T | ((previous: T) => T)) => {
      value = isSignalUpdater(next) ? next(value) : next;
    },
  ];
}

mock.module("solid-js", () => ({
  createSignal,
  createEffect: (callback: () => void) => {
    effectCallbacks.push(callback);
  },
  onCleanup: (callback: () => void) => {
    lifecycle.cleanups.push(callback);
  },
  onMount: (callback: () => void) => callback(),
  For: () => null,
  Show: () => null,
}));

mock.module("@opentui/solid", () => ({
  useKeyboard: (callback: (event: { readonly name?: string }) => void) => {
    keyboardCallbacks.push(callback);
  },
  useTerminalDimensions: () => () => ({ width: 80, height: 24 }),
}));

mock.module("@opentui/solid/jsx-runtime", () => ({
  Fragment: Symbol("fragment"),
  jsx: () => null,
  jsxDEV: () => null,
  jsxs: () => null,
}));

async function settlePromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createPtyHandle(id: PtyId): PtyHandle {
  return {
    id,
    write: () => {},
    resize: () => {},
    onData: () => () => {},
    onExit: () => () => {},
  };
}

function createMockPaneBackend(): PaneBackend {
  return {
    create: (options) => ({ id: "backend-pane", ptyOptions: options }),
    spawn: (manager, options) => manager.spawn(options),
    write: (session, data) => session.write(data),
    resize: (session, columns, rows) => session.resize(columns, rows),
    terminate: (manager, ptyId) => manager.terminate(ptyId),
  };
}

describe("Pane", () => {
  test("reuses an initial PTY handle instead of spawning", async () => {
    // Given
    const { Pane } = await import("../src/pane");
    const ptyManager = new FakePtyManager();
    const paneBackend = createMockPaneBackend();
    const onPtyReady = mock(async (_paneId: string, _handle: PtyHandle) => {});
    const initialHandle = createPtyHandle("pty-1");

    // When
    Pane({
      model: { id: "pane-1", ptyOptions: { command: "bash", args: [] } },
      ptyManager,
      paneBackend,
      focused: false,
      onFocus: () => {},
      onPtyReady,
      initialPtyHandle: initialHandle,
    });
    await settlePromises();

    // Then
    expect(onPtyReady).toHaveBeenCalledWith("pane-1", initialHandle);
    expect(ptyManager.spawnedOptions).toHaveLength(0);
  });

  test("spawns a new PTY when no initial handle is provided", async () => {
    // Given
    const { Pane } = await import("../src/pane");
    const ptyManager = new FakePtyManager();
    const onPtyReady = mock(async (_paneId: string, _handle: PtyHandle) => {});

    // When
    Pane({
      model: { id: "pane-1", ptyOptions: { command: "bash", args: [] } },
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady,
    });
    await settlePromises();

    // Then
    expect(ptyManager.spawnedOptions).toHaveLength(1);
    expect(onPtyReady).toHaveBeenCalledWith(
      "pane-1",
      expect.objectContaining({ id: "fake-pty-1" }),
    );
  });

  test("resizes PTY through handle when paneBackend is not provided", async () => {
    // Given
    const { Pane } = await import("../src/pane");
    const ptyManager = new FakePtyManager();
    const onPtyReady = mock(async (_paneId: string, _handle: PtyHandle) => {});
    const initialHandle = createPtyHandle("pty-1");
    const resized = { cols: 0, rows: 0 };
    initialHandle.resize = (cols, rows) => {
      resized.cols = cols;
      resized.rows = rows;
    };

    // When
    Pane({
      model: { id: "pane-1", ptyOptions: { command: "bash", args: [] } },
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady,
      initialPtyHandle: initialHandle,
    });
    await settlePromises();
    for (const callback of effectCallbacks) {
      callback();
    }

    // Then
    expect(resized.cols).toBe(80);
    expect(resized.rows).toBe(24);
  });

  test("resizes PTY through paneBackend when provided", async () => {
    // Given
    const { Pane } = await import("../src/pane");
    const ptyManager = new FakePtyManager();
    const paneBackend = createMockPaneBackend();
    const onPtyReady = mock(async (_paneId: string, _handle: PtyHandle) => {});
    const initialHandle = createPtyHandle("pty-1");
    const resized = { cols: 0, rows: 0 };
    paneBackend.resize = (_session, cols, rows) => {
      resized.cols = cols;
      resized.rows = rows;
    };

    // When
    Pane({
      model: { id: "pane-1", ptyOptions: { command: "bash", args: [] } },
      ptyManager,
      paneBackend,
      focused: false,
      onFocus: () => {},
      onPtyReady,
      initialPtyHandle: initialHandle,
    });
    await settlePromises();
    for (const callback of effectCallbacks) {
      callback();
    }

    // Then
    expect(resized.cols).toBe(80);
    expect(resized.rows).toBe(24);
  });

  test("subscribes to a pending PTY handle", async () => {
    // Given
    const { Pane } = await import("../src/pane");
    const ptyManager = new FakePtyManager();
    const onPtyReady = mock(async (_paneId: string, _handle: PtyHandle) => {});
    const pendingHandle = createPtyHandle("pending-pty");
    let resolvePending: ((handle: PtyHandle) => void) | undefined;
    const pending = new Promise<PtyHandle>((resolve) => {
      resolvePending = resolve;
    });

    // When
    Pane({
      model: { id: "pane-1", ptyOptions: { command: "bash", args: [] } },
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady,
      pendingPtyHandle: pending,
    });
    await settlePromises();
    resolvePending?.(pendingHandle);
    await settlePromises();

    // Then
    expect(ptyManager.spawnedOptions).toHaveLength(0);
    expect(onPtyReady).toHaveBeenCalledWith("pane-1", pendingHandle);
  });

  test("forwards keyboard input to PTY handle", async () => {
    // Given
    const { Pane } = await import("../src/pane");
    const ptyManager = new FakePtyManager();
    const onPtyReady = mock(async (_paneId: string, _handle: PtyHandle) => {});
    const initialHandle = createPtyHandle("pty-1");
    const written: string[] = [];
    initialHandle.write = (data) => written.push(data);

    // When
    Pane({
      model: { id: "pane-1", ptyOptions: { command: "bash", args: [] } },
      ptyManager,
      focused: true,
      onFocus: () => {},
      onPtyReady,
      initialPtyHandle: initialHandle,
    });
    await settlePromises();
    for (const callback of keyboardCallbacks) {
      callback({ name: "a", sequence: "a" });
    }

    // Then
    expect(written).toContain("a");
  });

  test("forwards keyboard input through paneBackend", async () => {
    // Given
    const { Pane } = await import("../src/pane");
    const ptyManager = new FakePtyManager();
    const paneBackend = createMockPaneBackend();
    const onPtyReady = mock(async (_paneId: string, _handle: PtyHandle) => {});
    const initialHandle = createPtyHandle("pty-1");
    const written: string[] = [];
    paneBackend.write = (_session, data) => written.push(data);

    // When
    Pane({
      model: { id: "pane-1", ptyOptions: { command: "bash", args: [] } },
      ptyManager,
      paneBackend,
      focused: true,
      onFocus: () => {},
      onPtyReady,
      initialPtyHandle: initialHandle,
    });
    await settlePromises();
    for (const callback of keyboardCallbacks) {
      callback({ name: "a", sequence: "a" });
    }

    // Then
    expect(written).toContain("a");
  });

  test("reports PTY cleanup errors to pane output", async () => {
    // Given
    const { Pane } = await import("../src/pane");
    const ptyManager = new FakePtyManager();
    const onPtyReady = mock((_paneId: string, _handle: PtyHandle) => Promise.resolve());
    const onPtyCleanup = mock(() => Promise.reject(new Error("cleanup failed")));
    const initialHandle = createPtyHandle("pty-1");

    // When
    Pane({
      model: { id: "pane-1", ptyOptions: { command: "bash", args: [] } },
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady,
      onPtyCleanup,
      initialPtyHandle: initialHandle,
    });
    await settlePromises();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const cleanup = getCleanup();
    cleanup?.();
    await settlePromises();
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Then
    expect(onPtyReady).toHaveBeenCalled();
    expect(onPtyCleanup).toHaveBeenCalled();
  });

  test("handles onPtyReady rejection", async () => {
    // Given
    const { Pane } = await import("../src/pane");
    const ptyManager = new FakePtyManager();
    const onPtyReady = mock(() => Promise.reject(new Error("ready failed")));
    const initialHandle = createPtyHandle("pty-1");

    // When
    Pane({
      model: { id: "pane-1", ptyOptions: { command: "bash", args: [] } },
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady,
      initialPtyHandle: initialHandle,
    });
    await settlePromises();
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Then
    expect(onPtyReady).toHaveBeenCalled();
  });

  test("handles pending PTY handle rejection", async () => {
    // Given
    const { Pane } = await import("../src/pane");
    const ptyManager = new FakePtyManager();
    const onPtyReady = mock(async (_paneId: string, _handle: PtyHandle) => {});
    const pending = Promise.reject(new Error("pending failed"));

    // When
    Pane({
      model: { id: "pane-1", ptyOptions: { command: "bash", args: [] } },
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady,
      pendingPtyHandle: pending,
    });
    await settlePromises();
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Then — no unhandled rejection should occur
    expect(ptyManager.spawnedOptions).toHaveLength(0);
  });

  test("handles PTY spawn rejection", async () => {
    // Given
    const { Pane } = await import("../src/pane");
    const ptyManager = new FakePtyManager();
    ptyManager.spawn = async () => {
      throw new Error("spawn failed");
    };
    const onPtyReady = mock(async (_paneId: string, _handle: PtyHandle) => {});

    // When
    Pane({
      model: { id: "pane-1", ptyOptions: { command: "bash", args: [] } },
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady,
    });
    await settlePromises();
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Then
    expect(onPtyReady).not.toHaveBeenCalled();
  });

  test("notifies onPtySpawn when spawning", async () => {
    // Given
    const { Pane } = await import("../src/pane");
    const ptyManager = new FakePtyManager();
    const onPtyReady = mock(async (_paneId: string, _handle: PtyHandle) => {});
    const onPtySpawn = mock((_paneId: string, _promise: Promise<PtyHandle>) => {});

    // When
    Pane({
      model: { id: "pane-1", ptyOptions: { command: "bash", args: [] } },
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady,
      onPtySpawn,
    });
    await settlePromises();

    // Then
    expect(onPtySpawn).toHaveBeenCalledWith("pane-1", expect.any(Promise));
  });

  test("cleans up on unmount", async () => {
    // Given
    const { Pane } = await import("../src/pane");
    const ptyManager = new FakePtyManager();
    const onPtyReady = mock(async (_paneId: string, _handle: PtyHandle) => {});
    const onPtyCleanup = mock(() => {});
    const unmountPane = mock(() => {});
    const initialHandle = createPtyHandle("pty-1");

    // When
    Pane({
      model: { id: "pane-1", ptyOptions: { command: "bash", args: [] } },
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady,
      onPtyCleanup,
      unmountPane,
      initialPtyHandle: initialHandle,
    });
    await settlePromises();
    const cleanup = getCleanup();
    cleanup?.();

    // Then
    expect(unmountPane).toHaveBeenCalledWith("pane-1");
    expect(onPtyCleanup).toHaveBeenCalledWith("pane-1", "pty-1");
  });
});
