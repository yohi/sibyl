/** @jsxImportSource @opentui/solid */
import { createSignal, For } from "solid-js"
import { Pane } from "./pane.js"
import type { PtyId, PtyManager } from "./pty-manager.js"
import type { PaneModel, SplitDirection } from "./types.js"

export interface LayoutManagerProps {
  ptyManager: PtyManager
  initialPanes: PaneModel[]
}

export function LayoutManager(props: LayoutManagerProps) {
  const [panes, setPanes] = createSignal(props.initialPanes)
  const [focusedId, setFocusedId] = createSignal<string | undefined>(props.initialPanes[0]?.id)
  const ptyIdsByPane = new Map<string, PtyId>()

  const splitPane = (id: string, direction: SplitDirection) => {
    setPanes((previous) => addPaneAt(previous, id, direction))
  }

  const closePane = async (id: string) => {
    const ptyId = ptyIdsByPane.get(id)
    if (ptyId) {
      await props.ptyManager.terminate(ptyId)
      ptyIdsByPane.delete(id)
    }
    const nextPanes = panes().filter((pane) => pane.id !== id)
    setPanes(nextPanes)
    setFocusedId((focused) => (focused === id ? nextPanes[0]?.id : focused))
  }

  return (
    <box flexDirection="row" flexGrow={1} width="100%" height="100%">
      <For each={panes()}>
        {(pane) => (
          <Pane
            model={pane}
            ptyManager={props.ptyManager}
            focused={focusedId() === pane.id}
            onFocus={() => setFocusedId(pane.id)}
            onPtyReady={(paneId, ptyId) => ptyIdsByPane.set(paneId, ptyId)}
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
