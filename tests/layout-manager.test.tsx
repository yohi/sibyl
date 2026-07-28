import { describe, expect, mock, test } from "bun:test"
import type { PtyHandle, PtyManager } from "../src/pty-manager"
import type { PaneModel } from "../src/types"
import { FakePtyManager } from "./fake-pty-manager"

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

interface RenderedNode {
  readonly type: unknown
  readonly props: Record<string, unknown>
}

const renderedNodes: RenderedNode[] = []

function renderNode(type: unknown, props?: Record<string, unknown>): RenderedNode {
  const node = { type, props: props ?? {} }
  renderedNodes.push(node)
  return node
}

mock.module("@opentui/solid/jsx-runtime", () => ({
  Fragment: Symbol("fragment"),
  jsx: renderNode,
  jsxDEV: renderNode,
  jsxs: renderNode,
}))

const nestedModel = {
  id: "root",
  direction: "horizontal",
  children: [
    { id: "pane-a", ptyOptions: { command: "fake-shell", args: [] } },
    {
      id: "right-split",
      direction: "vertical",
      children: [
        { id: "pane-b", ptyOptions: { command: "fake-shell", args: [] } },
        { id: "pane-c", ptyOptions: { command: "fake-shell", args: [] } },
      ],
    },
  ],
} satisfies PaneModel

function getOnlyRenderedNode(): RenderedNode {
  const node = renderedNodes.at(-1)
  if (!node) throw new Error("A layout node was not rendered")
  return node
}

function collectPaneIds(model: PaneModel): string[] {
  return [model.id, ...(model.children?.flatMap(collectPaneIds) ?? [])]
}

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
  test("accepts a nested model and propagates it to a recursive layout node", async () => {
    renderedNodes.length = 0
    const { LayoutManager, LayoutNode } = await import("../src/layout-manager")
    const ptyManager = new FakePtyManager()

    LayoutManager({ model: nestedModel, ptyManager })

    expect(getOnlyRenderedNode().type).toBe(LayoutNode)
    const renderedModel = getOnlyRenderedNode().props.model
    expect(typeof renderedModel).toBe("function")
    if (typeof renderedModel !== "function") throw new Error("Layout model accessor is missing")
    expect(renderedModel()).toBe(nestedModel)
    expect(getOnlyRenderedNode().props.ptyManager).toBe(ptyManager)
  })

  test("renders horizontal and vertical split boxes with matching flex directions", async () => {
    const { LayoutNode } = await import("../src/layout-manager")
    const ptyManager = new FakePtyManager()
    const nodeProps = {
      ptyManager,
      focusedId: () => "pane-a",
      onFocus: () => {},
      onPtyReady: async () => {},
    }

    renderedNodes.length = 0
    LayoutNode({ ...nodeProps, model: () => nestedModel })
    expect(getOnlyRenderedNode().type).toBe("box")
    expect(getOnlyRenderedNode().props.flexDirection).toBe("row")

    renderedNodes.length = 0
    const verticalModel = nestedModel.children?.[1]
    if (!verticalModel) throw new Error("Vertical split test fixture is incomplete")
    LayoutNode({ ...nodeProps, model: () => verticalModel })
    expect(getOnlyRenderedNode().type).toBe("box")
    expect(getOnlyRenderedNode().props.flexDirection).toBe("column")
  })

  test("renders from a reactive model accessor that excludes a closed pane", async () => {
    renderedNodes.length = 0
    const { LayoutNode, createLayoutManagerController } = await import("../src/layout-manager")
    const ptyManager = new FakePtyManager()
    const layout = createLayoutManagerController(ptyManager, nestedModel)

    LayoutNode({
      model: layout.model,
      ptyManager,
      focusedId: layout.focusedId,
      onFocus: layout.focusPane,
      onPtyReady: layout.onPtyReady,
    })
    expect(getOnlyRenderedNode().type).toBe("box")

    await layout.closePane("pane-b")

    expect(collectPaneIds(layout.model())).not.toContain("pane-b")
  })

  test("returns the leftmost leaf id from a nested model", async () => {
    const { firstLeafId } = await import("../src/layout-manager")

    expect(firstLeafId(nestedModel)).toBe("pane-a")
  })

  test("removes a nested leaf, terminates its PTY, and focuses the leftmost leaf", async () => {
    const { createLayoutManagerController } = await import("../src/layout-manager")
    const ptyManager = new FakePtyManager()
    const layout = createLayoutManagerController(ptyManager, nestedModel)
    const pty = await ptyManager.spawn({ command: "fake-shell", args: [] })

    await layout.onPtyReady("pane-b", pty.id)
    await layout.closePane("pane-b")

    expect(ptyManager.terminatedIds).toEqual([pty.id])
    expect(layout.model()).toEqual({
      id: "root",
      direction: "horizontal",
      children: [
        { id: "pane-a", ptyOptions: { command: "fake-shell", args: [] } },
        {
          id: "right-split",
          direction: "vertical",
          children: [{ id: "pane-c", ptyOptions: { command: "fake-shell", args: [] } }],
        },
      ],
    })
    expect(layout.focusedId()).toBe("pane-a")
  })

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
    const layout = createLayoutManagerController(ptyManager, {
      id: "root",
      children: [{ id: "pane-1", ptyOptions: { command: "fake-shell", args: [] } }],
    })
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
    expect(layout.model().children).toEqual([])
  })
})
