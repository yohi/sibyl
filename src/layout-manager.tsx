/** @jsxImportSource @opentui/solid */
import { For, Show, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import {
  findPane,
  nextLeaf,
  prevLeaf,
  removeLeaf,
  splitPane as splitPaneInTree,
} from "./keymap.js";
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
  readonly focusPane: (paneId: PaneId) => void;
}

export function createLayoutManagerController(
  _ptyManager: Pick<PtyManager, "terminate">,
  initialModel: PaneModel,
) {
  const [model, setModel] = createSignal(initialModel);
  const [focusedId, setFocusedId] = createSignal(firstLeafId(initialModel));

  const splitPane = (direction: SplitDirection, newPtyOptions: PtyOptions) => {
    const focused = focusedId();
    if (focused === undefined) return;
    const target = findPane(model(), focused);
    if (target === undefined || target.children !== undefined) return;

    setModel((current) => splitPaneInTree(current, focused, direction, newPtyOptions));
  };

  const closePane = async (id = focusedId()) => {
    if (id === undefined) return;
    const target = findPane(model(), id);
    if (target === undefined || target.children !== undefined) return;

    let focusCandidate: PaneId | undefined;
    setModel((current) => {
      focusCandidate = nextLeaf(current, id);
      return removeLeaf(current, id) ?? { id: current.id, children: [] };
    });

    const current = model();
    setFocusedId(
      focusCandidate !== undefined && findPane(current, focusCandidate) !== undefined
        ? focusCandidate
        : firstLeafId(current),
    );
  };

  const focusNext = () => {
    const focused = focusedId();
    if (focused !== undefined) setFocusedId(nextLeaf(model(), focused));
  };

  const focusPrev = () => {
    const focused = focusedId();
    if (focused !== undefined) setFocusedId(prevLeaf(model(), focused));
  };

  const onPtyReady = async (_paneId: PaneId, _ptyId: PtyId): Promise<void> => {};

  return {
    model,
    focusedId,
    splitPane,
    closePane,
    focusNext,
    focusPrev,
    onPtyReady,
    focusPane: setFocusedId,
  };
}

export function LayoutManager(props: LayoutManagerProps) {
  const { model, focusedId, onPtyReady, focusPane } = props.controller;
  const onPtyCleanup = (paneId: PaneId, ptyId: PtyId) => {
    if (findPane(model(), paneId) !== undefined) return;
    void props.ptyManager.terminate(ptyId);
  };

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
  readonly onPtyCleanup: (paneId: PaneId, ptyId: PtyId) => void;
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
          onPtyCleanup={(ptyId) => props.onPtyCleanup(props.model().id, ptyId)}
          cols={80}
          rows={24}
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
            {(childId) => (
              <LayoutNode
                model={() => {
                  const child = findPane(props.model(), childId);
                  if (child === undefined) throw new Error(`Pane ${childId} is missing`);
                  return child;
                }}
                ptyManager={props.ptyManager}
                focusedId={props.focusedId}
                onFocus={props.onFocus}
                onPtyReady={props.onPtyReady}
                onPtyCleanup={props.onPtyCleanup}
              />
            )}
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
