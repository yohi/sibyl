import { describe, expect, mock, test } from "bun:test"
import type { PtyHandle, PtyManager } from "../src/pty-manager"

const lifecycle: { cleanup?: () => void } = {}

function isSignalUpdater<T>(next: T | ((previous: T) => T)): next is (previous: T) => T {
  return typeof next === "function"
}

function getCleanup(): (() => void) | undefined {
  return lifecycle.cleanup
}

function createSignal<T>(initial: T) {
  let value = initial
  return [
    () => value,
    (next: T | ((previous: T) => T)) => {
      value = isSignalUpdater(next) ? next(value) : next
    },
  ]
}

mock.module("solid-js", () => ({
  createSignal,
  onCleanup: (callback: () => void) => {
    lifecycle.cleanup = callback
  },
  onMount: (callback: () => void) => callback(),
  For: () => null,
}))

mock.module("@opentui/solid", () => ({ useKeyboard: () => {} }))
mock.module("@opentui/solid/jsx-runtime", () => ({
  Fragment: Symbol("fragment"),
  jsx: () => null,
  jsxDEV: () => null,
  jsxs: () => null,
}))

function createDeferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve(value: T): void {
      if (!resolvePromise) throw new Error("Deferred promise is not initialized")
      resolvePromise(value)
    },
  }
}

describe("LayoutManager", () => {
  test("terminates a PTY that finishes spawning after its pane closes", async () => {
    lifecycle.cleanup = undefined
    const { createLayoutManagerController } = await import("../src/layout-manager")
    const { Pane } = await import("../src/pane")
    const spawnedPty = createDeferred<PtyHandle>()
    const terminated = createDeferred<void>()
    const terminatedPtyIds: string[] = []
    const ptyManager: Pick<PtyManager, "spawn" | "terminate"> = {
      spawn: () => spawnedPty.promise,
      terminate: async (ptyId) => {
        terminatedPtyIds.push(ptyId)
        terminated.resolve()
      },
    }
    const layout = createLayoutManagerController(ptyManager, [
      { id: "pane-1", ptyOptions: { command: "fake-shell", args: [] } },
    ])
    Pane({
      model: { id: "pane-1", ptyOptions: { command: "fake-shell", args: [] } },
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady: layout.onPtyReady,
      cols: 80,
      rows: 24,
    })

    await layout.closePane("pane-1")
    const paneCleanup = getCleanup()
    if (!paneCleanup) throw new Error("Pane cleanup was not registered")
    paneCleanup()
    spawnedPty.resolve({
      id: "pty-1",
      write: () => {},
      resize: () => {},
      onData: () => () => {},
      onExit: () => () => {},
    })
    await terminated.promise

    expect(terminatedPtyIds).toEqual(["pty-1"])
    expect(layout.panes()).toEqual([])
  })
})
