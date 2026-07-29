/** @jsxImportSource @opentui/solid */
import { createSignal, For } from "solid-js"
import type { Accessor } from "solid-js"
import {
  closePane as closePaneInTree,
  nextLeaf,
  prevLeaf,
  splitPane as splitPaneInTree,
} from "./keymap.js"
import { Pane } from "./pane.js"
import type { PtyId, PtyManager } from "./pty-manager.js"
import type { PaneId, PaneModel, PtyOptions, SplitDirection } from "./types.js"

type LayoutPtyManager = Pick<PtyManager, "spawn" | "terminate">

export interface LayoutManagerProps {
  readonly ptyManager: LayoutPtyManager
  readonly controller: LayoutManagerController
}

export interface LayoutManagerController {
  readonly model: Accessor<PaneModel>
  readonly focusedId: Accessor<PaneId | undefined>
  readonly splitPane: (direction: SplitDirection, newPtyOptions: PtyOptions) => void
  readonly closePane: (id?: PaneId) => Promise<void>
  readonly focusNext: () => void
  readonly focusPrev: () => void
  readonly onPtyReady: (paneId: PaneId, ptyId: PtyId) => Promise<void>
  readonly focusPane: (paneId: PaneId) => void
}

interface PendingPtyTermination {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

export function createLayoutManagerController(
  ptyManager: Pick<PtyManager, "terminate">,
  initialModel: PaneModel,
) {
  const [model, setModel] = createSignal(initialModel)
  const [focusedId, setFocusedId] = createSignal(firstLeafId(initialModel))
  const ptyIdsByPane = new Map<string, PtyId>()
  const pendingPtyTerminations = new Map<string, PendingPtyTermination>()

  const terminateLeaf = async (leaf: PaneModel) => {
    const ptyId = ptyIdsByPane.get(leaf.id)
    if (ptyId !== undefined) {
      await ptyManager.terminate(ptyId)
      ptyIdsByPane.delete(leaf.id)
      return
    }

    const pending = pendingPtyTerminations.get(leaf.id) ?? createPendingPtyTermination()
    pendingPtyTerminations.set(leaf.id, pending)
    await pending.promise
  }

  const splitPane = (direction: SplitDirection, newPtyOptions: PtyOptions) => {
    const focused = focusedId()
    if (focused === undefined) return
    setModel((current) => splitPaneInTree(current, focused, direction, newPtyOptions))
  }

  const closePane = async (id = focusedId()) => {
    if (id === undefined) return
    const current = model()
    const result = await closePaneInTree(current, id, terminateLeaf)
    setModel(result.root ?? { id: current.id, children: [] })
    setFocusedId(result.focusedId)
  }

  const focusNext = () => {
    const focused = focusedId()
    if (focused !== undefined) setFocusedId(nextLeaf(model(), focused))
  }

  const focusPrev = () => {
    const focused = focusedId()
    if (focused !== undefined) setFocusedId(prevLeaf(model(), focused))
  }

  const onPtyReady = async (paneId: string, ptyId: PtyId) => {
    const pending = pendingPtyTerminations.get(paneId)
    if (pending !== undefined) {
      try {
        await ptyManager.terminate(ptyId)
        ptyIdsByPane.delete(paneId)
        pending.resolve()
      } catch (error) {
        pending.reject(error)
        throw error
      } finally {
        pendingPtyTerminations.delete(paneId)
      }
      return
    }
    ptyIdsByPane.set(paneId, ptyId)
  }

  return {
    model,
    focusedId,
    splitPane,
    closePane,
    focusNext,
    focusPrev,
    onPtyReady,
    focusPane: setFocusedId,
  }
}

export function LayoutManager(props: LayoutManagerProps) {
  const { model, focusedId, onPtyReady, focusPane } = props.controller

  return (
    <LayoutNode
      model={model}
      ptyManager={props.ptyManager}
      focusedId={focusedId}
      onFocus={focusPane}
      onPtyReady={onPtyReady}
      isRoot={true}
    />
  )
}

export interface LayoutNodeProps {
  readonly model: Accessor<PaneModel>
  readonly ptyManager: LayoutPtyManager
  readonly focusedId: () => string | undefined
  readonly onFocus: (paneId: string) => void
  readonly onPtyReady: (paneId: string, ptyId: PtyId) => Promise<void>
  readonly isRoot?: boolean
}

export function LayoutNode(props: LayoutNodeProps) {
  const children = props.model().children
  if (children !== undefined) {
    return (
      <box
        flexDirection={props.model().direction === "vertical" ? "column" : "row"}
        flexGrow={1}
        width={props.isRoot ? "100%" : undefined}
        height={props.isRoot ? "100%" : undefined}
      >
        <For each={props.model().children}>
          {(child) => (
            <LayoutNode
              model={() => child}
              ptyManager={props.ptyManager}
              focusedId={props.focusedId}
              onFocus={props.onFocus}
              onPtyReady={props.onPtyReady}
            />
          )}
        </For>
      </box>
    )
  }

  return (
    <Pane
      model={props.model()}
      ptyManager={props.ptyManager}
      focused={props.focusedId() === props.model().id}
      onFocus={() => props.onFocus(props.model().id)}
      onPtyReady={props.onPtyReady}
      cols={80}
      rows={24}
    />
  )
}

export function firstLeafId(model: PaneModel): string | undefined {
  const children = model.children
  if (children === undefined) return model.id

  for (const child of children) {
    const leafId = firstLeafId(child)
    if (leafId !== undefined) return leafId
  }

  return undefined
}

function createPendingPtyTermination(): PendingPtyTermination {
  let resolvePromise: (() => void) | undefined
  let rejectPromise: ((error: unknown) => void) | undefined
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  if (resolvePromise === undefined || rejectPromise === undefined) {
    throw new Error("Failed to initialize pending PTY termination")
  }
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}
