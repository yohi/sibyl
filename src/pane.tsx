/** @jsxImportSource @opentui/solid */
import { useKeyboard } from "@opentui/solid"
import { createSignal, onCleanup, onMount } from "solid-js"
import { stripAnsi } from "./ansi-strip.js"
import type { PtyHandle, PtyId, PtyManager } from "./pty-manager.js"
import type { PaneModel } from "./types.js"

export interface PaneProps {
  model: PaneModel
  ptyManager: PtyManager
  focused: boolean
  onFocus: () => void
  onPtyReady: (paneId: string, ptyId: PtyId) => void
  cols: number
  rows: number
}

export function Pane(props: PaneProps) {
  const MAX_OUTPUT_LINES = 1000
  const [output, setOutput] = createSignal("")
  let ptyHandle: PtyHandle | undefined
  let disposed = false
  let pendingOsc = ""
  let removeDataListener = () => {}
  let removeExitListener = () => {}

  const appendOutput = (data: string) => {
    const raw = pendingOsc + data
    const lastOscStart = raw.lastIndexOf("\x1b]")
    const lastOsc = lastOscStart === -1 ? "" : raw.slice(lastOscStart)
    const isIncompleteOsc =
      lastOscStart !== -1 && !lastOsc.includes("\x07") && !lastOsc.includes("\x1b\\")
    const complete = isIncompleteOsc ? raw.slice(0, lastOscStart) : raw
    pendingOsc = isIncompleteOsc ? lastOsc : ""
    setOutput((previous) => {
      const lines = `${previous}${stripAnsi(complete)}`.split(/\r?\n/)
      return lines.slice(-MAX_OUTPUT_LINES).join("\n")
    })
  }

  onMount(() => {
    if (!props.model.ptyOptions) return
    void props.ptyManager
      .spawn(props.model.ptyOptions)
      .then((handle) => {
        if (disposed) return
        ptyHandle = handle
        props.onPtyReady(props.model.id, handle.id)
        removeDataListener = handle.onData(appendOutput)
        removeExitListener = handle.onExit(() => {
          removeDataListener()
          removeExitListener()
        })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        appendOutput(`PTY start failed: ${message}\n`)
      })
  })

  onCleanup(() => {
    disposed = true
    removeDataListener()
    removeExitListener()
  })

  useKeyboard((event) => {
    if (!props.focused || !ptyHandle) return
    ptyHandle.write(event.sequence ?? event.raw ?? event.name)
  })

  return (
    <box
      flexGrow={1}
      border={true}
      borderStyle="single"
      onMouseUp={props.onFocus}
      focusable={true}
    >
      <scrollbox flexGrow={1}>
        <text content={output()} />
      </scrollbox>
    </box>
  )
}
