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
}

export function Pane(props: PaneProps) {
  const MAX_OUTPUT_LINES = 1000;
  const [outputLines, setOutputLines] = createSignal<string[]>([]);
  const terminalDimensions = useTerminalDimensions();
  const [ptyHandle, setPtyHandle] = createSignal<PtyHandle>();
  let disposed = false;
  let pendingOsc = "";
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
    const newLines = stripAnsi(complete).split(/\r?\n/);
    setOutputLines((previous) => {
      const merged = [...previous, ...newLines];
      return merged.slice(-MAX_OUTPUT_LINES);
    });
  };

  onMount(() => {
    if (!props.model.ptyOptions) return;
    void props.ptyManager
      .spawn(props.model.ptyOptions)
      .then(async (handle) => {
        if (disposed) {
          void Promise.resolve(props.onPtyCleanup?.(props.model.id, handle.id)).catch(() => {});
          return;
        }
        await props.onPtyReady(props.model.id, handle.id);
        if (disposed) {
          void Promise.resolve(props.onPtyCleanup?.(props.model.id, handle.id)).catch(() => {});
          return;
        }
        const oldHandle = ptyHandle();
        if (oldHandle !== undefined) {
          void Promise.resolve(props.onPtyCleanup?.(props.model.id, oldHandle.id)).catch(() => {});
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
    if (handle !== undefined) {
      void Promise.resolve(props.onPtyCleanup?.(props.model.id, handle.id)).catch(() => {});
    }
  });

  useKeyboard((event) => {
    const handle = ptyHandle();
    if (!props.focused || !handle) return;
    const seq = event.sequence ?? event.raw ?? event.name;
    if (seq === undefined) return;
    handle.write(seq);
  });

  return (
    <box flexGrow={1} border={true} borderStyle="single" onMouseUp={props.onFocus} focusable={true}>
      <scrollbox flexGrow={1}>
        <text content={outputLines().join("\n")} />
      </scrollbox>
    </box>
  );
}
