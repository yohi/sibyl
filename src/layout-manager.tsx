/** @jsxImportSource @opentui/solid */
import { createSignal, For } from "solid-js"
import { Pane } from "./pane.js"
import type { PtyId, PtyManager } from "./pty-manager.js"
import type { PaneModel, SplitDirection } from "./types.js"

export interface LayoutManagerProps {
  ptyManager: PtyManager
  initialPanes: PaneModel[]
}

export function createLayoutManagerController(
  ptyManager: Pick<PtyManager, "terminate">,
  initialPanes: PaneModel[],
) {
  const [panes, setPanes] = createSignal(initialPanes)
  const [focusedId, setFocusedId] = createSignal<string | undefined>(initialPanes[0]?.id)
  const ptyIdsByPane = new Map<string, PtyId>()
  const pendingCloseIds = new Set<string>()

  const splitPane = (id: string, direction: SplitDirection) => {
    setPanes((previous) => addPaneAt(previous, id, direction))
  }

  const closePane = async (id: string) => {
    const ptyId = ptyIdsByPane.get(id)
    if (ptyId !== undefined) {
      await ptyManager.terminate(ptyId)
      ptyIdsByPane.delete(id)
    } else {
      pendingCloseIds.add(id)
    }
    const nextPanes = panes().filter((pane) => pane.id !== id)
    setPanes(nextPanes)
    setFocusedId((focused) => (focused === id ? nextPanes[0]?.id : focused))
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

  return { panes, focusedId, splitPane, closePane, onPtyReady, focusPane: setFocusedId }
}

export function LayoutManager(props: LayoutManagerProps) {
  const { panes, focusedId, onPtyReady, focusPane } = createLayoutManagerController(
    props.ptyManager,
    props.initialPanes,
  )

  return (
    <box flexDirection="row" flexGrow={1} width="100%" height="100%">
      <For each={panes()}>
        {(pane) => (
          <Pane
            model={pane}
            ptyManager={props.ptyManager}
            focused={focusedId() === pane.id}
            onFocus={() => focusPane(pane.id)}
            onPtyReady={onPtyReady}
            cols={80}
            rows={24}
          />
        )}
      </For>
    </box>
  )
}

function addPaneAt(
  panes: PaneModel[],
  _targetId: string,
  _direction: SplitDirection,
): PaneModel[] {
  return [...panes]
}
