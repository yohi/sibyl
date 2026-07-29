/** @jsxImportSource @opentui/solid */
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { stripAnsi } from "./ansi-strip.js";
import type { PtyHandle, PtyId, PtyManager } from "./pty-manager.js";
import type { PaneModel } from "./types.js";

export interface PaneProps {
  model: PaneModel;
  ptyManager: Pick<PtyManager, "spawn">;
  focused: boolean;
  onFocus: () => void;
  onPtyReady: (paneId: string, ptyId: PtyId) => Promise<void>;
  onPtyCleanup?: (paneId: string, ptyId: PtyId) => void;
  cols: number;
  rows: number;
}

export function Pane(props: PaneProps) {
  const MAX_OUTPUT_LINES = 1000;
  const [output, setOutput] = createSignal("");
  const terminalDimensions = useTerminalDimensions();
  const [ptyHandle, setPtyHandle] = createSignal<PtyHandle>();
  let disposed = false;
  let pendingOsc = "";
  let removeDataListener = () => {};
  let removeExitListener = () => {};

  createEffect(() => {
    const { width, height } = terminalDimensions();
    const cols = Math.floor(width);
    const rows = Math.floor(height);
    const handle = ptyHandle();
    if (handle !== undefined && cols > 0 && rows > 0) {
      handle.resize(cols, rows);
    }
  });

  const appendOutput = (data: string) => {
    const raw = pendingOsc + data;
    const lastOscStart = raw.lastIndexOf("\x1b]");
    const lastOsc = lastOscStart === -1 ? "" : raw.slice(lastOscStart);
    const isIncompleteOsc =
      lastOscStart !== -1 && !lastOsc.includes("\x07") && !lastOsc.includes("\x1b\\");
    const complete = isIncompleteOsc ? raw.slice(0, lastOscStart) : raw;
    pendingOsc = isIncompleteOsc ? lastOsc : "";
    setOutput((previous) => {
      const lines = `${previous}${stripAnsi(complete)}`.split(/\r?\n/);
      return lines.slice(-MAX_OUTPUT_LINES).join("\n");
    });
  };

  onMount(() => {
    if (!props.model.ptyOptions) return;
    void props.ptyManager
      .spawn(props.model.ptyOptions)
      .then(async (handle) => {
        await props.onPtyReady(props.model.id, handle.id);
        if (disposed) {
          props.onPtyCleanup?.(props.model.id, handle.id);
          return;
        }
        const oldHandle = ptyHandle();
        if (oldHandle !== undefined) {
          props.onPtyCleanup?.(props.model.id, oldHandle.id);
        }
        setPtyHandle(handle);
        removeDataListener = handle.onData(appendOutput);
        removeExitListener = handle.onExit(() => {
          removeDataListener();
          removeExitListener();
        });
      })
      .catch((error: unknown) => {
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        appendOutput(`PTY start failed: ${message}\n`);
      });
  });

  onCleanup(() => {
    disposed = true;
    removeDataListener();
    removeExitListener();
    const handle = ptyHandle();
    if (handle !== undefined) props.onPtyCleanup?.(props.model.id, handle.id);
  });

  useKeyboard((event) => {
    const handle = ptyHandle();
    if (!props.focused || !handle) return;
    handle.write(event.sequence ?? event.raw ?? event.name);
  });

  return (
    <box flexGrow={1} border={true} borderStyle="single" onMouseUp={props.onFocus} focusable={true}>
      <scrollbox flexGrow={1}>
        <text content={output()} />
      </scrollbox>
    </box>
  );
}
