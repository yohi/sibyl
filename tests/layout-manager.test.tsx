import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { PaneBackend } from "../src/pane-backend";
import type { PtyHandle, PtyManager } from "../src/pty-manager";
import type { PaneModel } from "../src/types";
import { FakePtyManager } from "./fake-pty-manager";

// allow: SIZE_OK — Solid lifecycle mocks intentionally share one module-scoped LayoutManager suite.
const lifecycle: { cleanups: (() => void)[]; cleanup?: () => void } = { cleanups: [] };
const keyboardCallbacks: Array<(event: { readonly name?: string }) => void> = [];

beforeEach(() => {
  keyboardCallbacks.length = 0;
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
  For,
  Show,
}));

mock.module("@opentui/solid", () => ({
  useKeyboard: (callback: (event: { readonly name?: string }) => void) => {
    keyboardCallbacks.push(callback);
  },
  useTerminalDimensions: () => () => ({ width: 80, height: 24 }),
}));

interface RenderedNode {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

const renderedNodes: RenderedNode[] = [];

function renderNode(type: unknown, props?: Record<string, unknown>): RenderedNode | null {
  if (type === Show) return Show(props ?? {});
  if (type === For) return For(props ?? {});
  const node = { type, props: props ?? {} };
  renderedNodes.push(node);
  return node;
}

function Show(props: Readonly<Record<string, unknown>>): RenderedNode {
  const content = props.when
    ? isShowRenderFunction(props.children)
      ? props.children(() => props.when)
      : props.children
    : props.fallback;
  if (!isRenderedNode(content)) throw new Error("Show did not render a layout node");
  return content;
}

const renderedForItems: unknown[][] = [];

function For(props: Readonly<Record<string, unknown>>): null {
  const items = props.each;
  if (!Array.isArray(items)) throw new Error("For items are missing");
  renderedForItems.push(items);
  if (typeof props.children === "function") {
    for (const item of items) {
      props.children(item);
    }
  }
  return null;
}

function isShowRenderFunction(value: unknown): value is (when: () => unknown) => unknown {
  return typeof value === "function";
}

function isRenderedNode(value: unknown): value is RenderedNode {
  return typeof value === "object" && value !== null && "type" in value && "props" in value;
}

mock.module("@opentui/solid/jsx-runtime", () => ({
  Fragment: Symbol("fragment"),
  jsx: renderNode,
  jsxDEV: renderNode,
  jsxs: renderNode,
}));

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
} satisfies PaneModel;

function getOnlyRenderedNode(): RenderedNode {
  const node = renderedNodes.at(-1);
  if (!node) throw new Error("A layout node was not rendered");
  return node;
}

function collectPaneIds(model: PaneModel): string[] {
  return [model.id, ...(model.children?.flatMap(collectPaneIds) ?? [])];
}

import { createDeferred } from "./helpers/deferred";

function createPtyHandle(id: string): PtyHandle {
  return {
    id,
    write: () => {},
    resize: () => {},
    onData: () => () => {},
    onExit: () => () => {},
  };
}

async function settlePromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("LayoutManager", () => {
  test("accepts a nested model and propagates it to a recursive layout node", async () => {
    renderedNodes.length = 0;
    const { LayoutManager, LayoutNode, createLayoutManagerController } = await import(
      "../src/layout-manager"
    );
    const ptyManager = new FakePtyManager();
    const controller = createLayoutManagerController(ptyManager, nestedModel);

    LayoutManager({ controller, ptyManager });

    expect(getOnlyRenderedNode().type).toBe(LayoutNode);
    const renderedModel = getOnlyRenderedNode().props.model;
    expect(typeof renderedModel).toBe("function");
    if (typeof renderedModel !== "function") throw new Error("Layout model accessor is missing");
    expect(renderedModel()).toBe(nestedModel);
    expect(getOnlyRenderedNode().props.ptyManager).toBe(ptyManager);
  });

  test("renders horizontal and vertical split boxes with matching flex directions", async () => {
    const { LayoutNode } = await import("../src/layout-manager");
    const ptyManager = new FakePtyManager();
    const nodeProps = {
      ptyManager,
      focusedId: () => "pane-a",
      onFocus: () => {},
      onPtyReady: async () => {},
      onPtyCleanup: (_paneId: string, ptyId: string) => ptyManager.terminate(ptyId),
    };

    renderedNodes.length = 0;
    LayoutNode({ ...nodeProps, model: () => nestedModel });
    expect(getOnlyRenderedNode().type).toBe("box");
    expect(getOnlyRenderedNode().props.flexDirection).toBe("row");

    renderedNodes.length = 0;
    const verticalModel = nestedModel.children?.[1];
    if (!verticalModel) throw new Error("Vertical split test fixture is incomplete");
    LayoutNode({ ...nodeProps, model: () => verticalModel });
    expect(getOnlyRenderedNode().type).toBe("box");
    expect(getOnlyRenderedNode().props.flexDirection).toBe("column");
  });

  test("renders from a reactive model accessor that excludes a closed pane", async () => {
    renderedNodes.length = 0;
    const { LayoutNode, createLayoutManagerController } = await import("../src/layout-manager");
    const ptyManager = new FakePtyManager();
    const layout = createLayoutManagerController(ptyManager, nestedModel);
    const pty = await ptyManager.spawn({ command: "fake-shell", args: [] });
    await layout.onPtyReady("pane-b", pty.id);

    LayoutNode({
      model: layout.model,
      ptyManager,
      focusedId: layout.focusedId,
      onFocus: layout.focusPane,
      onPtyReady: layout.onPtyReady,
      onPtyCleanup: (_paneId, ptyId) => ptyManager.terminate(ptyId),
    });
    expect(getOnlyRenderedNode().type).toBe("box");

    await layout.closePane("pane-b");

    expect(collectPaneIds(layout.model())).not.toContain("pane-b");
  });

  test("returns the leftmost leaf id from a nested model", async () => {
    const { firstLeafId } = await import("../src/layout-manager");

    expect(firstLeafId(nestedModel)).toBe("pane-a");
  });

  test("keeps a recursive child accessor current after splitting a descendant", async () => {
    // Given
    renderedNodes.length = 0;
    const { LayoutNode, createLayoutManagerController } = await import("../src/layout-manager");
    const model = {
      id: "root",
      direction: "horizontal" as const,
      children: [
        { id: "pane-a", ptyOptions: { command: "fake-shell", args: [] } },
        {
          id: "inner-split",
          direction: "vertical" as const,
          children: [{ id: "pane-b", ptyOptions: { command: "fake-shell", args: [] } }],
        },
      ],
    } satisfies PaneModel;
    const ptyManager = new FakePtyManager();
    const layout = createLayoutManagerController(ptyManager, model);

    LayoutNode({
      model: layout.model,
      ptyManager,
      focusedId: layout.focusedId,
      onFocus: layout.focusPane,
      onPtyReady: layout.onPtyReady,
      onPtyCleanup: layout.onPtyCleanup,
    });
    const innerNode = renderedNodes.find(
      (node) =>
        node.type === LayoutNode &&
        typeof node.props.model === "function" &&
        node.props.model().id === "inner-split",
    );
    if (!innerNode || typeof innerNode.props.model !== "function") {
      throw new Error("Nested layout node was not rendered");
    }

    layout.focusPane("pane-b");

    // When
    layout.splitPane("vertical", { command: "fake-shell", args: [] });

    // Then
    expect(innerNode.props.model().children?.[0]?.children).toBeDefined();
  });

  test("terminates a pane PTY before removing its model", async () => {
    // Given
    const { createLayoutManagerController } = await import("../src/layout-manager");
    const termination = createDeferred<void>();
    const ptyManager = {
      terminate: async () => {
        expect(layout.model().children?.map((child) => child.id)).toEqual(["left", "right"]);
        await termination.promise;
      },
    };
    const layout = createLayoutManagerController(ptyManager, {
      id: "root",
      direction: "horizontal",
      children: [
        { id: "left", ptyOptions: { command: "fake-shell", args: [] } },
        { id: "right", ptyOptions: { command: "fake-shell", args: [] } },
      ],
    });
    await layout.onPtyReady("left", "pty-left");

    // When
    const closing = layout.closePane("left");
    await Promise.resolve();

    // Then
    expect(layout.model().children?.map((child) => child.id)).toEqual(["left", "right"]);
    termination.resolve();
    await closing;
    expect(layout.model()).toEqual({
      id: "right",
      ptyOptions: { command: "fake-shell", args: [] },
    });
  });

  test("creates split panes through the configured pane backend", async () => {
    // Given
    const { createLayoutManagerController } = await import("../src/layout-manager");
    const created: PaneModel[] = [];
    const paneBackend: PaneBackend = {
      create: (options) => {
        const pane = { id: "backend-pane", ptyOptions: options };
        created.push(pane);
        return pane;
      },
      spawn: (manager, options) => manager.spawn(options),
      write: (session, data) => session.write(data),
      resize: (session, columns, rows) => session.resize(columns, rows),
      terminate: (manager, ptyId) => manager.terminate(ptyId),
    };
    const ptyManager = new FakePtyManager();
    const layout = createLayoutManagerController(
      ptyManager,
      { id: "pane-a", ptyOptions: { command: "fake-shell", args: [] } },
      paneBackend,
    );

    // When
    layout.splitPane("horizontal", { command: "fake-shell", args: [] });

    // Then
    expect(created).toHaveLength(1);
    expect(layout.model().children?.[1]?.id).toBe("backend-pane");
  });

  test("terminates the closed pane PTY through the controller", async () => {
    const { createLayoutManagerController } = await import("../src/layout-manager");
    const ptyManager = new FakePtyManager();
    const layout = createLayoutManagerController(ptyManager, nestedModel);
    const pty = await ptyManager.spawn({ command: "fake-shell", args: [] });

    await layout.onPtyReady("pane-b", pty.id);
    await layout.closePane("pane-b");

    expect(ptyManager.terminatedIds).toEqual([pty.id]);
    expect(layout.model()).toEqual({
      id: "root",
      direction: "horizontal",
      children: [
        { id: "pane-a", ptyOptions: { command: "fake-shell", args: [] } },
        { id: "pane-c", ptyOptions: { command: "fake-shell", args: [] } },
      ],
    });
    expect(layout.focusedId()).toBe("pane-c");
  });

  test("keeps the pane-to-PTY mapping when cleanup termination fails so close can retry", async () => {
    const { createLayoutManagerController } = await import("../src/layout-manager");
    let terminationAttempts = 0;
    const ptyManager = {
      terminate: async () => {
        terminationAttempts += 1;
        if (terminationAttempts === 1) throw new Error("PTY did not exit");
      },
    };
    const layout = createLayoutManagerController(ptyManager, {
      id: "pane-a",
      ptyOptions: { command: "fake-shell", args: [] },
    });
    await layout.onPtyReady("pane-a", "pty-a");

    await expect(layout.onPtyCleanup("pane-a", "pty-a")).rejects.toThrow("PTY did not exit");
    await layout.closePane("pane-a");

    expect(terminationAttempts).toBe(2);
    expect(layout.model().children).toEqual([]);
  });

  test("terminates a stale PTY when the pane was removed before spawn resolved", async () => {
    const { createLayoutManagerController } = await import("../src/layout-manager");
    const ptyManager = new FakePtyManager();
    const layout = createLayoutManagerController(ptyManager, {
      id: "root",
      direction: "horizontal",
      children: [{ id: "pane-a", ptyOptions: { command: "fake-shell", args: [] } }],
    });

    // Simulate a late onPtyReady call after the pane was closed (stale PTY)
    const stalePty = await ptyManager.spawn({ command: "fake-shell", args: [] });
    await layout.closePane("pane-a");
    await layout.onPtyReady("pane-a", stalePty.id);

    // onPtyReady should detect pane absence and terminate the stale PTY immediately
    expect(ptyManager.terminatedIds).toContain(stalePty.id);
  });
  test("terminates the closed pane PTY while preserving untouched branches", async () => {
    const { createLayoutManagerController } = await import("../src/layout-manager");
    const model = {
      id: "root",
      direction: "horizontal",
      children: [
        {
          id: "left-split",
          direction: "vertical",
          children: [
            { id: "pane-a", ptyOptions: { command: "fake-shell", args: [] } },
            { id: "pane-b", ptyOptions: { command: "fake-shell", args: [] } },
          ],
        },
        { id: "pane-c", ptyOptions: { command: "fake-shell", args: [] } },
      ],
    } satisfies PaneModel;
    const untouchedBranch = model.children[0];
    const ptyManager = new FakePtyManager();
    const layout = createLayoutManagerController(ptyManager, model);
    const paneAPty = await ptyManager.spawn({ command: "fake-shell", args: [] });
    const paneBPty = await ptyManager.spawn({ command: "fake-shell", args: [] });
    const paneCPty = await ptyManager.spawn({ command: "fake-shell", args: [] });

    await layout.onPtyReady("pane-a", paneAPty.id);
    await layout.onPtyReady("pane-b", paneBPty.id);
    await layout.onPtyReady("pane-c", paneCPty.id);
    const initialSpawnCount = ptyManager.spawnedOptions.length;

    await layout.closePane("pane-c");

    expect(ptyManager.terminatedIds).toEqual([paneCPty.id]);
    expect(ptyManager.spawnedOptions).toHaveLength(initialSpawnCount);
    expect(layout.model()).toBe(untouchedBranch);
  });

  test("terminates the original PTY when it resolves after its pane unmounts during a split", async () => {
    // Given
    lifecycle.cleanup = undefined;
    const { createLayoutManagerController } = await import("../src/layout-manager");
    const { Pane } = await import("../src/pane");
    const originalPty = createDeferred<PtyHandle>();
    const replacementPty = createDeferred<PtyHandle>();
    const terminatedPtyIds: string[] = [];
    const ptysToSpawn = [originalPty.promise, replacementPty.promise];
    const ptyManager: Pick<PtyManager, "spawn" | "terminate"> = {
      spawn: () => {
        const pty = ptysToSpawn.shift();
        if (!pty) throw new Error("Unexpected PTY spawn");
        return pty;
      },
      terminate: async (ptyId) => {
        terminatedPtyIds.push(ptyId);
      },
    };
    const layout = createLayoutManagerController(ptyManager, {
      id: "pane-a",
      ptyOptions: { command: "fake-shell", args: [] },
    });

    Pane({
      model: { id: "pane-a", ptyOptions: { command: "fake-shell", args: [] } },
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady: layout.onPtyReady,
      onPtyCleanup: (_paneId, ptyId) => ptyManager.terminate(ptyId),
    });
    const originalPaneCleanup = getCleanup();
    if (!originalPaneCleanup) throw new Error("Original Pane cleanup was not registered");

    // When
    layout.splitPane("horizontal", { command: "fake-shell", args: [] });
    originalPaneCleanup();
    const replacementModel = layout.model().children?.[0];
    if (!replacementModel) throw new Error("Split replacement pane is missing");
    Pane({
      model: replacementModel,
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady: layout.onPtyReady,
      onPtyCleanup: (_paneId, ptyId) => ptyManager.terminate(ptyId),
    });
    originalPty.resolve(createPtyHandle("pty-original"));
    replacementPty.resolve(createPtyHandle("pty-replacement"));
    await Promise.all([originalPty.promise, replacementPty.promise]);
    await settlePromises();

    // Then
    expect(ptysToSpawn).toHaveLength(0);
    expect(terminatedPtyIds).toEqual(["pty-original"]);
  });

  test("keeps a pane in the model until its close termination starts", async () => {
    // Given
    lifecycle.cleanup = undefined;
    const { createLayoutManagerController } = await import("../src/layout-manager");
    const { Pane } = await import("../src/pane");
    const terminationStarted = createDeferred<void>();
    const finishTermination = createDeferred<void>();
    const terminatedPtyIds: string[] = [];
    const ptysToSpawn = [
      createPtyHandle("pty-original"),
      createPtyHandle("pty-replacement"),
      createPtyHandle("pty-sibling"),
    ];
    const ptyManager: Pick<PtyManager, "spawn" | "terminate"> = {
      spawn: async () => {
        const pty = ptysToSpawn.shift();
        if (!pty) throw new Error("Unexpected PTY spawn");
        return pty;
      },
      terminate: async (ptyId) => {
        terminatedPtyIds.push(ptyId);
        if (ptyId === "pty-original") {
          terminationStarted.resolve();
          await finishTermination.promise;
        }
      },
    };
    const layout = createLayoutManagerController(ptyManager, {
      id: "pane-a",
      ptyOptions: { command: "fake-shell", args: [] },
    });

    Pane({
      model: { id: "pane-a", ptyOptions: { command: "fake-shell", args: [] } },
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady: layout.onPtyReady,
      onPtyCleanup: (_paneId, ptyId) => ptyManager.terminate(ptyId),
    });
    await settlePromises();
    const originalPaneCleanup = getCleanup();
    if (!originalPaneCleanup) throw new Error("Original Pane cleanup was not registered");

    // When
    layout.splitPane("vertical", { command: "fake-shell", args: [] });
    originalPaneCleanup();
    const splitChildren = layout.model().children;
    const replacementModel = splitChildren?.[0];
    const siblingModel = splitChildren?.[1];
    if (!replacementModel || !siblingModel) throw new Error("Split pane models are missing");
    Pane({
      model: replacementModel,
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady: layout.onPtyReady,
      onPtyCleanup: (_paneId, ptyId) => ptyManager.terminate(ptyId),
    });
    const replacementPaneCleanup = getCleanup();
    if (!replacementPaneCleanup) throw new Error("Replacement Pane cleanup was not registered");
    Pane({
      model: siblingModel,
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady: layout.onPtyReady,
      onPtyCleanup: (_paneId, ptyId) => ptyManager.terminate(ptyId),
    });
    await settlePromises();
    await terminationStarted.promise;
    const closing = layout.closePane("pane-a");

    // Then
    expect(collectPaneIds(layout.model())).toContain(replacementModel.id);
    expect(collectPaneIds(layout.model())).toContain(siblingModel.id);
    replacementPaneCleanup();
    await closing;
    expect(collectPaneIds(layout.model())).toEqual([siblingModel.id]);
    expect(layout.focusedId()).toBe(siblingModel.id);
    expect(terminatedPtyIds).toEqual(["pty-original", "pty-replacement", "pty-replacement"]);
    expect(terminatedPtyIds).not.toContain("pty-sibling");
    finishTermination.resolve();
    await settlePromises();
  });

  test("keeps the surviving split pane PTY active when cleanup follows a shrink", async () => {
    lifecycle.cleanup = undefined;
    renderedNodes.length = 0;
    const { LayoutManager, createLayoutManagerController } = await import("../src/layout-manager");
    const { Pane } = await import("../src/pane");
    const model = {
      id: "root",
      direction: "horizontal",
      children: [
        { id: "pane-a", ptyOptions: { command: "fake-shell", args: [] } },
        { id: "pane-b", ptyOptions: { command: "fake-shell", args: [] } },
      ],
    } satisfies PaneModel;
    const closingPane = model.children[0];
    const survivingPane = model.children[1];
    if (!closingPane || !survivingPane) throw new Error("Split pane test fixture is incomplete");

    const ptyManager = new FakePtyManager();
    const layout = createLayoutManagerController(ptyManager, model);

    LayoutManager({ controller: layout, ptyManager });
    const onPtyCleanup = getOnlyRenderedNode().props.onPtyCleanup;
    if (typeof onPtyCleanup !== "function") {
      throw new Error("LayoutManager PTY cleanup callback is missing");
    }

    Pane({
      model: closingPane,
      ptyManager,
      focused: true,
      onFocus: () => {},
      onPtyReady: layout.onPtyReady,
      onPtyCleanup: (_paneId, ptyId) => onPtyCleanup(closingPane.id, ptyId),
    });
    await settlePromises();
    const closingPaneCleanup = getCleanup();
    if (!closingPaneCleanup) throw new Error("Closing Pane cleanup was not registered");

    Pane({
      model: survivingPane,
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady: layout.onPtyReady,
      onPtyCleanup: (_paneId, ptyId) => onPtyCleanup(survivingPane.id, ptyId),
    });
    await settlePromises();
    const survivingPaneCleanup = getCleanup();
    if (!survivingPaneCleanup) throw new Error("Surviving Pane cleanup was not registered");

    const [closingPtyId, survivingPtyId] = ptyManager.writes.keys();
    if (!closingPtyId || !survivingPtyId) throw new Error("Split pane PTYs were not spawned");

    await layout.closePane(closingPane.id);
    closingPaneCleanup();
    survivingPaneCleanup();

    expect(ptyManager.terminatedIds).toEqual([closingPtyId, survivingPtyId]);
    expect(ptyManager.spawnedOptions).toHaveLength(2);
  });

  test("does not respawn the surviving pane PTY when closing a sibling", async () => {
    renderedNodes.length = 0;
    const { LayoutNode, createLayoutManagerController } = await import("../src/layout-manager");
    const { Pane } = await import("../src/pane");
    const model = {
      id: "root",
      direction: "horizontal",
      children: [
        { id: "pane-a", ptyOptions: { command: "fake-shell", args: [] } },
        { id: "pane-b", ptyOptions: { command: "fake-shell", args: [] } },
      ],
    } satisfies PaneModel;
    const closingPane = model.children[0];
    const survivingPane = model.children[1];
    if (!closingPane || !survivingPane) throw new Error("Split pane test fixture is incomplete");

    const ptyManager = new FakePtyManager();
    const layout = createLayoutManagerController(ptyManager, model);
    const ptyIds = new Map<string, string>();
    const onPtyReady = async (paneId: string, ptyId: string) => {
      if (!ptyIds.has(paneId)) ptyIds.set(paneId, ptyId);
    };
    const nodeProps = {
      model: layout.model,
      ptyManager,
      focusedId: layout.focusedId,
      onFocus: layout.focusPane,
      onPtyReady,
      onPtyCleanup: (_paneId: string, ptyId: string) => ptyManager.terminate(ptyId),
    };

    LayoutNode(nodeProps);
    expect(getOnlyRenderedNode().type).toBe("box");

    Pane({
      model: survivingPane,
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady,
      onPtyCleanup: (_paneId, ptyId) => ptyManager.terminate(ptyId),
    });
    await settlePromises();
    const originalPtyId = ptyIds.get(survivingPane.id);

    await layout.closePane(closingPane.id);

    renderedNodes.length = 0;
    LayoutNode(nodeProps);
    if (getOnlyRenderedNode().type === Pane) {
      Pane({
        model: survivingPane,
        ptyManager,
        focused: true,
        onFocus: () => {},
        onPtyReady,
        onPtyCleanup: (_paneId, ptyId) => ptyManager.terminate(ptyId),
      });
      await settlePromises();
    }

    expect(ptyIds.get(survivingPane.id)).toBe(originalPtyId);
  });

  test("collapses an inner split when closing its sibling", async () => {
    lifecycle.cleanup = undefined;
    renderedNodes.length = 0;
    renderedForItems.length = 0;
    const { LayoutNode, createLayoutManagerController } = await import("../src/layout-manager");
    const { Pane } = await import("../src/pane");
    const outerLeft = { id: "outer-left", ptyOptions: { command: "fake-shell", args: [] } };
    const innerLeft = { id: "inner-left", ptyOptions: { command: "fake-shell", args: [] } };
    const innerRight = { id: "inner-right", ptyOptions: { command: "fake-shell", args: [] } };
    const innerSplit = {
      id: "inner-split",
      direction: "vertical" as const,
      children: [innerLeft, innerRight],
    };
    const model = {
      id: "root",
      direction: "horizontal" as const,
      children: [outerLeft, innerSplit],
    } satisfies PaneModel;
    const ptyManager = new FakePtyManager();
    const layout = createLayoutManagerController(ptyManager, model);
    const ptyIds = new Map<string, string>();
    const onPtyReady = async (paneId: string, ptyId: string) => {
      if (!ptyIds.has(paneId)) ptyIds.set(paneId, ptyId);
    };
    const nodeProps = {
      model: layout.model,
      ptyManager,
      focusedId: layout.focusedId,
      onFocus: layout.focusPane,
      onPtyReady,
      onPtyCleanup: (_paneId: string, ptyId: string) => ptyManager.terminate(ptyId),
    };

    LayoutNode(nodeProps);
    const initialRootForItems = renderedForItems.at(-1);
    const innerSplitKey = initialRootForItems?.[1];
    if (innerSplitKey === undefined) throw new Error("Inner split is missing from the root layout");

    Pane({
      model: innerLeft,
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady,
      onPtyCleanup: () => {},
    });
    await settlePromises();
    const originalPtyId = ptyIds.get(innerLeft.id);

    await layout.closePane(innerRight.id);

    expect(layout.model().children?.[1]).toBe(innerLeft);

    renderedNodes.length = 0;
    renderedForItems.length = 0;
    LayoutNode(nodeProps);
    const updatedRootForItems = renderedForItems.at(-1);
    expect(updatedRootForItems).toEqual([outerLeft.id, innerLeft.id]);

    Pane({
      model: innerLeft,
      ptyManager,
      focused: false,
      onFocus: () => {},
      onPtyReady,
      onPtyCleanup: () => {},
    });
    await settlePromises();

    expect(ptyIds.get(innerLeft.id)).toBe(originalPtyId);
  });

  test("routes focused pane input through the configured pane backend only", async () => {
    const { Pane } = await import("../src/pane");
    const ptyManager = new FakePtyManager();
    const backendWrites: string[] = [];
    const paneBackend: PaneBackend = {
      create: (options) => ({ id: "backend-pane", ptyOptions: options }),
      spawn: (manager, options) => manager.spawn(options),
      write: (_session, data) => {
        backendWrites.push(data);
      },
      resize: () => {},
      terminate: (manager, ptyId) => manager.terminate(ptyId),
    };

    Pane({
      model: { id: "pane-a", ptyOptions: { command: "fake-shell", args: [] } },
      ptyManager,
      paneBackend,
      focused: true,
      onFocus: () => {},
      onPtyReady: async () => {},
    });
    await settlePromises();
    const onKeyPress = keyboardCallbacks.at(-1);
    if (!onKeyPress) throw new Error("Pane keyboard handler was not registered");

    onKeyPress({ name: "x" });

    expect(backendWrites).toEqual(["x"]);
    expect(ptyManager.writes.get("fake-pty-1")).toEqual([]);
  });

  test("clears a naturally exited PTY handle before routing another keypress", async () => {
    const { Pane } = await import("../src/pane");
    const ptyManager = new FakePtyManager();
    const exited: Array<readonly [string, string]> = [];

    Pane({
      model: { id: "pane-a", ptyOptions: { command: "fake-shell", args: [] } },
      ptyManager,
      focused: true,
      onFocus: () => {},
      onPtyReady: async () => {},
      onPtyExit: (paneId, ptyId) => exited.push([paneId, ptyId]),
    });
    await settlePromises();
    ptyManager.emitExit("fake-pty-1", { exitCode: 0 });
    const onKeyPress = keyboardCallbacks.at(-1);
    if (!onKeyPress) throw new Error("Pane keyboard handler was not registered");

    onKeyPress({ name: "x" });

    expect(exited).toEqual([["pane-a", "fake-pty-1"]]);
    expect(ptyManager.writes.get("fake-pty-1")).toEqual([]);
  });
});
