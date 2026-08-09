import { describe, expect, test } from "bun:test";
import { attachSubagentIntegration } from "../src/subagent-integration";

function makeApi(config: unknown) {
  const layers: unknown[] = [];
  const disposers: Array<() => unknown> = [];
  return {
    api: {
      state: { config, path: { directory: "/repo" } },
      keymap: {
        registerLayer: (layer: unknown) => {
          layers.push(layer);
          return () => {};
        },
      },
      lifecycle: {
        onDispose: (handler: () => unknown) => {
          disposers.push(handler);
          return () => {};
        },
      },
      event: { on: () => () => {} },
      client: { session: { list: async () => ({ data: [] }) } },
    } as never,
    layers,
    disposers,
  };
}

const layout = {} as never;
const paneBackend = {} as never;
const ptyManager = {} as never;

describe("attachSubagentIntegration", () => {
  test("registers the toggle command and returns disabled without connection settings", async () => {
    const { api, layers } = makeApi({});
    const handle = await attachSubagentIntegration(
      api,
      {},
      { layout, paneBackend, ptyManager, env: {} },
    );
    const commands = (layers[0] as { commands: Array<{ name: string }> }).commands;

    expect(handle.enabled).toBe(false);
    expect(commands.map((command) => command.name)).toContain("sibyl.toggleSubagentDisplay");
    await handle.stop();
  });

  test("starts an enabled manager from environment configuration", async () => {
    const { api, disposers } = makeApi({});
    const handle = await attachSubagentIntegration(
      api,
      {},
      {
        layout,
        paneBackend,
        ptyManager,
        env: {
          SIBYL_SUBAGENT_ENABLED: "true",
          OPENCODE_SERVER_URL: "http://localhost:3000",
          OPENCODE_PROJECT_DIR: "/repo",
        },
      },
    );

    expect(handle.enabled).toBe(true);
    expect(disposers).toHaveLength(1);
    await handle.stop();
  });
});
