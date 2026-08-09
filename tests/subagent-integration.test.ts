import { describe, expect, test } from "bun:test";
import { attachSubagentIntegration, createDefaultAttachTarget } from "../src/subagent-integration";

function makeApi(
  config: unknown,
  lifecycleSignal?: AbortSignal,
  subscribe?: (options: { signal: AbortSignal }) => Promise<{ stream: AsyncIterable<unknown> }>,
) {
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
        signal: lifecycleSignal,
        onDispose: (handler: () => unknown) => {
          disposers.push(handler);
          return () => {};
        },
      },
      event: { on: () => () => {} },
      client: {
        session: { list: async () => ({ data: [] }) },
        event: subscribe === undefined ? undefined : { subscribe },
      },
    } as never,
    layers,
    disposers,
  };
}

const layout = {} as never;
const paneBackend = {} as never;
const ptyManager = {} as never;

describe("attachSubagentIntegration", () => {
  test("creates attach targets from subagent sessions", () => {
    expect(createDefaultAttachTarget({ id: "ses-1", time: { created: 42 } })).toEqual({
      sessionId: "ses-1",
      createdAt: 42,
    });
  });

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
    const toggle = (
      layers[0] as { commands: Array<{ name: string; run: () => unknown }> }
    ).commands.find((command) => command.name === "sibyl.toggleSubagentDisplay");
    await toggle?.run();
    await handle.stop();
  });

  test("starts an enabled manager from environment configuration", async () => {
    const { api, disposers, layers } = makeApi({});
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
    const commands = (layers[0] as { commands: Array<{ name: string; run: () => unknown }> })
      .commands;
    await commands.find((command) => command.name === "sibyl.toggleSubagentDisplay")?.run();
    await handle.stop();
  });

  test("starts and stops the SSE event source through the TUI runtime", async () => {
    const lifecycle = new AbortController();
    const { api } = makeApi({}, lifecycle.signal, async () => ({ stream: [] }));
    const handle = await attachSubagentIntegration(
      api,
      {},
      {
        layout,
        paneBackend,
        ptyManager,
        env: {
          SIBYL_SUBAGENT_ENABLED: "true",
          SIBYL_SUBAGENT_SSE: "true",
          OPENCODE_SERVER_URL: "http://localhost:3000",
          OPENCODE_PROJECT_DIR: "/repo",
        },
      },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    lifecycle.abort();
    await handle.stop();
    expect(handle.enabled).toBe(true);
  });
});
