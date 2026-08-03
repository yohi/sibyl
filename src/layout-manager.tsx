/** @jsxImportSource @opentui/solid */
import { For, Show, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import {
  closePane as closePaneInTree,
  findPane,
  nextLeaf,
  prevLeaf,
  splitPane as splitPaneInTree,
} from "./keymap.js";
import type { PaneBackend, PanePtyManager } from "./pane-backend.js";
import { Pane } from "./pane.js";
import type { PtyHandle, PtyManager } from "./pty-manager.js";
import type { PaneId, PaneModel, PtyOptions, SplitDirection } from "./types.js";

type LayoutPtyManager = PanePtyManager;

export interface LayoutManagerProps {
  readonly ptyManager: LayoutPtyManager;
  readonly paneBackend?: PaneBackend;
  readonly controller: LayoutManagerController;
}

export interface LayoutManagerController {
  readonly model: Accessor<PaneModel>;
  readonly focusedId: Accessor<PaneId | undefined>;
  readonly splitPane: (direction: SplitDirection, newPtyOptions: PtyOptions) => void;
  readonly closePane: (id?: PaneId) => Promise<void>;
  readonly focusNext: () => void;
  readonly focusPrev: () => void;
  readonly onPtyReady: (paneId: PaneId, handle: PtyHandle) => Promise<void>;
  readonly onPtyExit: (paneId: PaneId, ptyId: string) => void;
  readonly onPtyCleanup: (paneId: PaneId, ptyId: string) => Promise<void>;
  readonly focusPane: (paneId: PaneId) => void;
  readonly getInitialPtyHandle: (paneId: PaneId) => PtyHandle | undefined;
  readonly getPendingPtyHandle: (paneId: PaneId) => Promise<PtyHandle> | undefined;
  readonly onPtySpawn: (paneId: PaneId, promise: Promise<PtyHandle>) => void;
  readonly mountPane: (paneId: PaneId) => void;
  readonly unmountPane: (paneId: PaneId) => void;
}

export function createLayoutManagerController(
  ptyManager: Pick<PtyManager, "terminate">,
  initialModel: PaneModel,
  paneBackend?: PaneBackend,
): LayoutManagerController {
  const [model, setModel] = createSignal(initialModel);
  const [focusedId, setFocusedId] = createSignal(firstLeafId(initialModel));
  const ptyHandleByPane = new Map<PaneId, PtyHandle>();
  const terminatedPtyIds = new Set<string>();
  const pendingSpawns = new Map<PaneId, Promise<PtyHandle>>();
  const cleanupCancellers = new Map<PaneId, () => void>();
  const mountedPaneIds = new Set<PaneId>();
  const mountPane = (paneId: PaneId): void => {
    mountedPaneIds.add(paneId);
  };
  const unmountPane = (paneId: PaneId): void => {
    mountedPaneIds.delete(paneId);
  };

  const cancelCleanup = (paneId: PaneId): void => {
    const cancel = cleanupCancellers.get(paneId);
    if (cancel !== undefined) {
      cancel();
      cleanupCancellers.delete(paneId);
    }
  };

  const scheduleCleanup = (paneId: PaneId, ptyId: string): void => {
    cancelCleanup(paneId);
    let cancelled = false;
    cleanupCancellers.set(paneId, () => {
      cancelled = true;
    });
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      cleanupCancellers.delete(paneId);
      const currentHandle = ptyHandleByPane.get(paneId);
      if (
        mountedPaneIds.has(paneId) &&
        findPane(model(), paneId) !== undefined &&
        (currentHandle === undefined || currentHandle.id === ptyId)
      ) {
        return;
      }
      await doTerminate(ptyId).catch(() => {});
      const postAwaitHandle = ptyHandleByPane.get(paneId);
      if (postAwaitHandle?.id === ptyId) {
        ptyHandleByPane.delete(paneId);
      }
    });
  };

  const doTerminate = async (ptyId: string): Promise<void> => {
    if (terminatedPtyIds.has(ptyId)) return;
    terminatedPtyIds.add(ptyId);
    try {
      await (paneBackend?.terminate(ptyManager, ptyId) ?? ptyManager.terminate(ptyId));
    } catch (error) {
      terminatedPtyIds.delete(ptyId);
      throw error;
    }
  };

  const splitPane = (direction: SplitDirection, newPtyOptions: PtyOptions) => {
    const focused = focusedId();
    if (focused === undefined) return;
    const target = findPane(model(), focused);
    if (target === undefined || target.children !== undefined) return;

    setModel((current) =>
      splitPaneInTree(
        current,
        focused,
        direction,
        newPtyOptions,
        paneBackend ? (options) => paneBackend.create(options) : undefined,
      ),
    );
  };

  const closePane = async (id = focusedId()) => {
    if (id === undefined) return;
    const target = findPane(model(), id);
    if (target === undefined || target.children !== undefined) return;

    const closeResult = await closePaneInTree(model(), id, async () => {
      const handle = ptyHandleByPane.get(id);
      if (handle === undefined) return;
      cancelCleanup(id);
      pendingSpawns.delete(id);
      await doTerminate(handle.id);
      ptyHandleByPane.delete(id);
    });

    const nextModel = closeResult.root ?? { id: model().id, children: [] };
    setModel(nextModel);
    setFocusedId(closeResult.focusedId ?? firstLeafId(nextModel));
  };

  const focusNext = () => {
    const focused = focusedId();
    if (focused !== undefined) setFocusedId(nextLeaf(model(), focused));
  };

  const focusPrev = () => {
    const focused = focusedId();
    if (focused !== undefined) setFocusedId(prevLeaf(model(), focused));
  };

  const onPtyReady = async (paneId: PaneId, handle: PtyHandle): Promise<void> => {
    // ペインがモデルから既に削除されている場合、受信した PTY は直ちに終了する。
    if (!findPane(model(), paneId)) {
      await doTerminate(handle.id).catch(() => {});
      return;
    }
    cancelCleanup(paneId);
    ptyHandleByPane.set(paneId, handle);
    pendingSpawns.delete(paneId);
  };

  const onPtyExit = (paneId: PaneId, ptyId: string): void => {
    const handle = ptyHandleByPane.get(paneId);
    if (handle?.id === ptyId) ptyHandleByPane.delete(paneId);
  };

  const onPtyCleanup = async (paneId: PaneId, ptyId: string): Promise<void> => {
    // レイアウト変更による再マウントでは、cleanup の直後に同じ pane id で Pane が mount し直し、
    // 同じ PTY ハンドルが再利用される。その間にマッピングを削除しないよう、遅延クリーンアップする。
    scheduleCleanup(paneId, ptyId);
  };

  const onPtySpawn = (paneId: PaneId, promise: Promise<PtyHandle>): void => {
    pendingSpawns.set(paneId, promise);
  };

  const getInitialPtyHandle = (paneId: PaneId): PtyHandle | undefined => {
    return ptyHandleByPane.get(paneId);
  };

  const getPendingPtyHandle = (paneId: PaneId): Promise<PtyHandle> | undefined => {
    return pendingSpawns.get(paneId);
  };

  return {
    model,
    focusedId,
    splitPane,
    closePane,
    focusNext,
    focusPrev,
    onPtyReady,
    onPtyExit,
    onPtyCleanup,
    focusPane: setFocusedId,
    getInitialPtyHandle,
    getPendingPtyHandle,
    onPtySpawn,
    mountPane,
    unmountPane,
  };
}

export function LayoutManager(props: LayoutManagerProps) {
  const controller = props.controller;

  return (
    <LayoutNode
      model={controller.model}
      ptyManager={props.ptyManager}
      paneBackend={props.paneBackend}
      focusedId={controller.focusedId}
      onFocus={controller.focusPane}
      onPtyReady={controller.onPtyReady}
      onPtyExit={controller.onPtyExit}
      onPtyCleanup={controller.onPtyCleanup}
      getInitialPtyHandle={controller.getInitialPtyHandle}
      getPendingPtyHandle={controller.getPendingPtyHandle}
      onPtySpawn={controller.onPtySpawn}
      mountPane={controller.mountPane}
      unmountPane={controller.unmountPane}
      isRoot={true}
    />
  );
}

export interface LayoutNodeProps {
  readonly model: Accessor<PaneModel>;
  readonly ptyManager: LayoutPtyManager;
  readonly paneBackend?: PaneBackend;
  readonly focusedId: () => string | undefined;
  readonly onFocus: (paneId: string) => void;
  readonly onPtyReady: (paneId: string, handle: PtyHandle) => Promise<void>;
  readonly onPtyExit?: (paneId: PaneId, ptyId: string) => void;
  readonly onPtyCleanup: (paneId: PaneId, ptyId: string) => Promise<void> | void;
  readonly getInitialPtyHandle?: (paneId: string) => PtyHandle | undefined;
  readonly getPendingPtyHandle?: (paneId: string) => Promise<PtyHandle> | undefined;
  readonly onPtySpawn?: (paneId: string, promise: Promise<PtyHandle>) => void;
  readonly mountPane?: (paneId: string) => void;
  readonly unmountPane?: (paneId: string) => void;
  readonly isRoot?: boolean;
}

export function LayoutNode(props: LayoutNodeProps) {
  return (
    <Show
      when={props.model().children}
      fallback={
        <Pane
          model={props.model()}
          ptyManager={props.ptyManager}
          paneBackend={props.paneBackend}
          initialPtyHandle={props.getInitialPtyHandle?.(props.model().id)}
          pendingPtyHandle={props.getPendingPtyHandle?.(props.model().id)}
          focused={props.focusedId() === props.model().id}
          onFocus={() => props.onFocus(props.model().id)}
          onPtyReady={props.onPtyReady}
          onPtySpawn={props.onPtySpawn}
          onPtyExit={props.onPtyExit}
          onPtyCleanup={(_paneId, ptyId) => props.onPtyCleanup(props.model().id, ptyId)}
          mountPane={props.mountPane}
          unmountPane={props.unmountPane}
        />
      }
    >
      {(children) => (
        <box
          flexDirection={props.model().direction === "vertical" ? "column" : "row"}
          flexGrow={1}
          width={props.isRoot ? "100%" : undefined}
          height={props.isRoot ? "100%" : undefined}
        >
          <For each={children().map((child) => child.id)}>
            {(childId) => {
              const childModel = findPane(props.model(), childId);
              if (childModel === undefined) return null;
              return (
                <LayoutNode
                  model={() => findPane(props.model(), childId) ?? childModel}
                  ptyManager={props.ptyManager}
                  paneBackend={props.paneBackend}
                  focusedId={props.focusedId}
                  onFocus={props.onFocus}
                  onPtyReady={props.onPtyReady}
                  onPtyExit={props.onPtyExit}
                  onPtyCleanup={props.onPtyCleanup}
                  getInitialPtyHandle={props.getInitialPtyHandle}
                  getPendingPtyHandle={props.getPendingPtyHandle}
                  onPtySpawn={props.onPtySpawn}
                  mountPane={props.mountPane}
                  unmountPane={props.unmountPane}
                  isRoot={false}
                />
              );
            }}
          </For>
        </box>
      )}
    </Show>
  );
}

export function firstLeafId(model: PaneModel): string | undefined {
  const children = model.children;
  if (children === undefined) return model.id;

  for (const child of children) {
    const leafId = firstLeafId(child);
    if (leafId !== undefined) return leafId;
  }

  return undefined;
}
