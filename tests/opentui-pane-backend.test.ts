import { describe, expect, test } from "bun:test";
import { OpenTuiPaneBackend } from "../src/opentui-pane-backend";
import type { PtyHandle, PtyManager } from "../src/pty-manager";

describe("OpenTuiPaneBackend", () => {
  test("returns a pane model with PTY options", () => {
    const backend = new OpenTuiPaneBackend();
    const pane = backend.create({
      command: "bash",
      args: [],
      cols: 80,
      rows: 24,
    });

    expect(pane.ptyOptions).toEqual({
      command: "bash",
      args: [],
      cols: 80,
      rows: 24,
    });
  });

  test("delegates the pane session lifecycle through the configured PTY manager", async () => {
    const handle: PtyHandle = {
      id: "pty-1",
      write: () => {},
      resize: () => {},
      onData: () => () => {},
      onExit: () => () => {},
    };
    const spawnedOptions: unknown[] = [];
    const writes: string[] = [];
    const resizes: Array<readonly [number, number]> = [];
    const terminatedIds: string[] = [];
    const ptyManager: Pick<PtyManager, "spawn" | "terminate"> = {
      spawn: async (options) => {
        spawnedOptions.push(options);
        return {
          ...handle,
          write: (data) => writes.push(data),
          resize: (columns, rows) => resizes.push([columns, rows]),
        };
      },
      terminate: async (id) => {
        terminatedIds.push(id);
      },
    };
    const backend = new OpenTuiPaneBackend();
    const options = { command: "bash", args: [] };

    const session = await backend.spawn(ptyManager, options);
    backend.write(session, "echo sibyl\r");
    backend.resize(session, 120, 40);
    await backend.terminate(ptyManager, session.id);

    expect(spawnedOptions).toEqual([options]);
    expect(writes).toEqual(["echo sibyl\r"]);
    expect(resizes).toEqual([[120, 40]]);
    expect(terminatedIds).toEqual(["pty-1"]);
  });
});
