/** @jsxImportSource @opentui/solid */
import { createSignal, For } from "solid-js"
import type { Accessor } from "solid-js"
import { Pane } from "./pane.js"
import type { PtyId, PtyManager } from "./pty-manager.js"
import type { PaneModel } from "./types.js"

type LayoutPtyManager = Pick<PtyManager, "spawn" | "terminate">

export interface LayoutManagerProps {
  readonly ptyManager: LayoutPtyManager
  readonly model: PaneModel
}

export function createLayoutManagerController(
  ptyManager: Pick<PtyManager, "terminate">,
  initialModel: PaneModel,
) {
  const [model, setModel] = createSignal(initialModel)
  const [focusedId, setFocusedId] = createSignal(firstLeafId(initialModel))
  const ptyIdsByPane = new Map<string, PtyId>()
  const pendingCloseIds = new Set<string>()

  const closePane = async (id: string) => {
    const ptyId = ptyIdsByPane.get(id)
    if (ptyId !== undefined) {
      await ptyManager.terminate(ptyId)
      ptyIdsByPane.delete(id)
    } else {
      pendingCloseIds.add(id)
    }
    const nextModel = removeLeaf(model(), id)
    setModel(nextModel)
    setFocusedId((focused) => (focused === id ? firstLeafId(nextModel) : focused))
  }

  const onPtyReady = async (paneId: string, ptyId: PtyId) => {
    if (pendingCloseIds.has(paneId)) {
      await ptyManager.terminate(ptyId)
      pendingCloseIds.delete(paneId)
      ptyIdsByPane.delete(paneId)
      return
    }
    ptyIdsByPane.set(paneId, ptyId)
  }

  return { model, focusedId, closePane, onPtyReady, focusPane: setFocusedId }
}

export function LayoutManager(props: LayoutManagerProps) {
  const { model, focusedId, onPtyReady, focusPane } = createLayoutManagerController(
    props.ptyManager,
    props.model,
  )

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

function removeLeaf(model: PaneModel, paneId: string): PaneModel {
  return removeNode(model, paneId) ?? { id: model.id, children: [] }
}

function removeNode(model: PaneModel, paneId: string): PaneModel | undefined {
  const children = model.children
  if (children === undefined) {
    return model.id === paneId ? undefined : model
  }

  const nextChildren: PaneModel[] = []
  for (const child of children) {
    const nextChild = removeNode(child, paneId)
    if (nextChild !== undefined) nextChildren.push(nextChild)
  }
  return { ...model, children: nextChildren }
}
