/** @jsxImportSource @opentui/solid */
import { For, Show, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import {
  closePane as closePaneInTree,
  findPane,
  nextLeaf,
  prevLeaf,
  removeLeaf,
  splitPane as splitPaneInTree,
} from "./keymap.js";
import type { PaneBackend } from "./pane-backend.js";
import { Pane } from "./pane.js";
import type { PtyId, PtyManager } from "./pty-manager.js";
import type { PaneId, PaneModel, PtyOptions, SplitDirection } from "./types.js";

type LayoutPtyManager = Pick<PtyManager, "spawn" | "terminate">;

export interface LayoutManagerProps {
  readonly ptyManager: LayoutPtyManager;
  readonly controller: LayoutManagerController;
}

export interface LayoutManagerController {
  readonly model: Accessor<PaneModel>;
  readonly focusedId: Accessor<PaneId | undefined>;
  readonly splitPane: (direction: SplitDirection, newPtyOptions: PtyOptions) => void;
  readonly closePane: (id?: PaneId) => Promise<void>;
  readonly focusNext: () => void;
  readonly focusPrev: () => void;
  readonly onPtyReady: (paneId: PaneId, ptyId: PtyId) => Promise<void>;
  readonly onPtyCleanup: (paneId: PaneId, ptyId: PtyId) => Promise<void>;
  readonly focusPane: (paneId: PaneId) => void;
}
export function createLayoutManagerController(
  ptyManager: Pick<PtyManager, "terminate">,
  initialModel: PaneModel,
  paneBackend?: PaneBackend,
): LayoutManagerController {
  const [model, setModel] = createSignal(initialModel);
  const [focusedId, setFocusedId] = createSignal(firstLeafId(initialModel));
  const ptyIdByPane = new Map<PaneId, PtyId>();
  const terminatedPtyIds = new Set<PtyId>();
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
      const ptyId = ptyIdByPane.get(id);
      if (ptyId === undefined) return;
      if (!terminatedPtyIds.has(ptyId)) {
        terminatedPtyIds.add(ptyId);
        try {
          await ptyManager.terminate(ptyId);
        } catch (error) {
          terminatedPtyIds.delete(ptyId);
          throw error;
        }
      }
      ptyIdByPane.delete(id);
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

  const onPtyReady = async (paneId: PaneId, ptyId: PtyId): Promise<void> => {
    // ペインがモデルから既に削除されている場合、受信した PTY は直ちに終了する。
    if (!findPane(model(), paneId)) {
      await ptyManager.terminate(ptyId);
      return;
    }
    ptyIdByPane.set(paneId, ptyId);
  };

  const onPtyCleanup = async (paneId: PaneId, ptyId: PtyId): Promise<void> => {
    if (ptyIdByPane.get(paneId) === ptyId) ptyIdByPane.delete(paneId);
    if (terminatedPtyIds.has(ptyId)) return;
    terminatedPtyIds.add(ptyId);
    await ptyManager.terminate(ptyId);
  };

  return {
    model,
    focusedId,
    splitPane,
    closePane,
    focusNext,
    focusPrev,
    onPtyReady,
    onPtyCleanup,
    focusPane: setFocusedId,
  };
}

export function LayoutManager(props: LayoutManagerProps) {
  const { model, focusedId, onPtyReady, onPtyCleanup, focusPane } = props.controller;

  return (
    <LayoutNode
      model={model}
      ptyManager={props.ptyManager}
      focusedId={focusedId}
      onFocus={focusPane}
      onPtyReady={onPtyReady}
      onPtyCleanup={onPtyCleanup}
      isRoot={true}
    />
  );
}

export interface LayoutNodeProps {
  readonly model: Accessor<PaneModel>;
  readonly ptyManager: LayoutPtyManager;
  readonly focusedId: () => string | undefined;
  readonly onFocus: (paneId: string) => void;
  readonly onPtyReady: (paneId: string, ptyId: PtyId) => Promise<void>;
  readonly onPtyCleanup: (paneId: PaneId, ptyId: PtyId) => Promise<void> | void;
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
          focused={props.focusedId() === props.model().id}
          onFocus={() => props.onFocus(props.model().id)}
          onPtyReady={props.onPtyReady}
          onPtyCleanup={(_paneId, ptyId) => props.onPtyCleanup(props.model().id, ptyId)}
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
                  focusedId={props.focusedId}
                  onFocus={props.onFocus}
                  onPtyReady={props.onPtyReady}
                  onPtyCleanup={props.onPtyCleanup}
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
