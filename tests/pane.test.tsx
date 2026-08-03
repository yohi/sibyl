import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { PaneBackend } from "../src/pane-backend";
import type { PtyHandle, PtyId, PtyManager } from "../src/pty-manager";
import type { PaneModel } from "../src/types";
import { FakePtyManager } from "./fake-pty-manager";

const lifecycle: { cleanups: (() => void)[] } = { cleanups: [] };
const keyboardCallbacks: Array<(event: { readonly name?: string }) => void> = [];

beforeEach(() => {
  keyboardCallbacks.length = 0;
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
  createEffect: () => {},
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
    const onPtyReady = mock(async (_paneId: string, _ptyId: PtyId) => {});
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
    const onPtyReady = mock(async (_paneId: string, _ptyId: PtyId) => {});

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
    expect(onPtyReady).toHaveBeenCalledWith("pane-1", expect.objectContaining({ id: "fake-pty-1" }));
  });
});
