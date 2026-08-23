import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import plugin, { createTuiPlugin } from "../src/tui";

const originalObserverEnabled = process.env.SIBYL_OBSERVER_ENABLED;

beforeAll(() => {
  delete process.env.SIBYL_OBSERVER_ENABLED;
});

afterAll(() => {
  process.env.SIBYL_OBSERVER_ENABLED = originalObserverEnabled;
});

function makeApi(config: unknown, warnings: string[] = []) {
  const disposers: Array<() => void | Promise<void>> = [];
  const registrations: unknown[] = [];
  const routeCalls: unknown[] = [];
  const keymapCalls: unknown[] = [];
  const api = {
    state: { config },
    slots: {
      register(plugin: unknown): string {
        registrations.push(plugin);
        return `registration-${registrations.length}`;
      },
    },
    route: {
      register: (routes: unknown) => {
        routeCalls.push(routes);
        return () => {};
      },
      navigate: (...args: unknown[]) => routeCalls.push(args),
    },
    keymap: {
      registerLayer: (layer: unknown) => {
        keymapCalls.push(layer);
        return () => {};
      },
    },
    lifecycle: {
      signal: new AbortController().signal,
      onDispose(handler: () => void | Promise<void>) {
        disposers.push(handler);
        return () => {};
      },
    },
  };
  return { api, disposers, warnings, registrations, routeCalls, keymapCalls };
}

function handle() {
  return { enabled: false, stop: async () => {}, resyncNow: async () => {} };
}

describe("TUI plugin", () => {
  test("exports default plugin object", () => {
    expect(plugin).toHaveProperty("id");
    expect(plugin).toHaveProperty("tui");
    expect(typeof plugin.tui).toBe("function");
  });

  test("passes observer plugin options to attachment without route or keymap calls", async () => {
    let receivedEnabled: boolean | undefined;
    const { api, registrations, routeCalls, keymapCalls } = makeApi({});
    const tui = createTuiPlugin({
      env: {},
      attach: async (runtime, config) => {
        receivedEnabled = config.enabled;
        runtime.slots.register({ slots: { sidebar_content: () => null } });
        return handle();
      },
    });

    await Reflect.apply(tui, undefined, [api, { observer: { enabled: true } }, undefined]);

    expect(receivedEnabled).toBe(true);
    expect(registrations).toHaveLength(1);
    expect(Object.keys((registrations[0] as { slots: object }).slots)).toEqual(["sidebar_content"]);
    expect(routeCalls).toEqual([]);
    expect(keymapCalls).toEqual([]);
  });

  test("warns once per invocation when legacy settings are present and ignores them", async () => {
    const warnings: string[] = [];
    const { api } = makeApi({ sibyl: { subagentDisplay: { enabled: true, maxPanes: 4 } } });
    const tui = createTuiPlugin({
      env: { SIBYL_SUBAGENT_ENABLED: "true", OPENCODE_SERVER_URL: "http://localhost:3000" },
      logger: { info: () => {}, warn: (message) => warnings.push(message), error: () => {} },
      attach: async (_runtime, config) => {
        expect(config.enabled).toBe(false);
        return handle();
      },
    });

    await Reflect.apply(tui, undefined, [api, undefined, undefined]);

    expect(warnings).toEqual([
      "[subagent] legacy PTY display, connection, and attach settings are deprecated and ignored by Sibyl v2 Observer",
    ]);
  });
});
