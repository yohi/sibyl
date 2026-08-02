/** @jsxImportSource @opentui/solid */
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { PaneBackend, PaneSpawner } from "./pane-backend.js";
import type { PtyHandle, PtyId } from "./pty-manager.js";
import { PtyOutputBuffer } from "./pty-output-buffer.js";
import type { PaneModel } from "./types.js";

export interface PaneProps {
  model: PaneModel;
  ptyManager: PaneSpawner;
  paneBackend?: PaneBackend;
  focused: boolean;
  onFocus: () => void;
  onPtyReady: (paneId: string, ptyId: PtyId) => Promise<void>;
  onPtyExit?: (paneId: string, ptyId: PtyId) => void;
  onPtyCleanup?: (paneId: string, ptyId: PtyId) => Promise<void> | void;
}

export function Pane(props: PaneProps) {
  const outputBuffer = new PtyOutputBuffer(1000);
  const [outputText, setOutputText] = createSignal("");
  const terminalDimensions = useTerminalDimensions();
  const [ptyHandle, setPtyHandle] = createSignal<PtyHandle>();
  let disposed = false;
  let removeDataListener = () => {};
  let removeExitListener = () => {};

  createEffect(() => {
    // OpenTUI does not currently expose per-pane dimensions, so we fall back
    // to the full terminal size. When a pane-level size API becomes available,
    // replace terminalDimensions() with that measurement.
    const { width, height } = terminalDimensions();
    const cols = Math.floor(width);
    const rows = Math.floor(height);
    const handle = ptyHandle();
    if (handle !== undefined && cols > 0 && rows > 0) {
      if (props.paneBackend) {
        props.paneBackend.resize(handle, cols, rows);
      } else {
        handle.resize(cols, rows);
      }
    }
  });

  const appendOutput = (data: string) => {
    setOutputText(outputBuffer.append(data));
  };

  const cleanupPty = (ptyId: PtyId) => {
    const cleanup = props.onPtyCleanup?.(props.model.id, ptyId);
    if (cleanup === undefined) return;
    void Promise.resolve(cleanup).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      appendOutput(`PTY cleanup failed: ${message}\n`);
    });
  };

  onMount(() => {
    if (!props.model.ptyOptions) return;
    const spawn =
      props.paneBackend?.spawn(props.ptyManager, props.model.ptyOptions) ??
      props.ptyManager.spawn(props.model.ptyOptions);
    void spawn
      .then(async (handle) => {
        if (disposed) {
          cleanupPty(handle.id);
          return;
        }
        await props.onPtyReady(props.model.id, handle.id);
        if (disposed) {
          cleanupPty(handle.id);
          return;
        }
        const oldHandle = ptyHandle();
        if (oldHandle !== undefined) {
          cleanupPty(oldHandle.id);
        }
        setPtyHandle(handle);
        removeDataListener = handle.onData(appendOutput);
        removeExitListener = handle.onExit(() => {
          removeDataListener();
          removeExitListener();
          setPtyHandle();
          props.onPtyExit?.(props.model.id, handle.id);
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
    if (handle !== undefined) {
      cleanupPty(handle.id);
    }
  });

  useKeyboard((event) => {
    const handle = ptyHandle();
    if (!props.focused || !handle) return;
    const seq = event.sequence ?? event.raw ?? event.name;
    if (seq === undefined) return;
    if (props.paneBackend) {
      props.paneBackend.write(handle, seq);
    } else {
      handle.write(seq);
    }
  });

  return (
    <box flexGrow={1} border={true} borderStyle="single" onMouseUp={props.onFocus} focusable={true}>
      <scrollbox flexGrow={1}>
        <text content={outputText()} />
      </scrollbox>
    </box>
  );
}
