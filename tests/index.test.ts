import { describe, expect, test } from "bun:test";

describe("published package entrypoints", () => {
  test("exports observer-safe core modules without legacy PTY integration", async () => {
    const exports = await import("../dist/index.js");

    expect(Object.keys(exports)).toEqual(
      expect.arrayContaining([
        "DEFAULT_OBSERVER_CONFIG",
        "SubagentRegistry",
        "SseEventSource",
        "SubagentValidationError",
        "TuiEventBusSource",
        "createOpenCodeSnapshotReader",
        "normalizeRuntimeStatus",
        "redactAndTruncate",
        "resolveObserverConfig",
        "safeToolName",
      ]),
    );

    for (const removed of [
      "SubagentLifecycleManager",
      "SubagentPaneAdapter",
      "attachSubagentIntegration",
      "buildAttachPtyOptions",
      "buildSseHeaders",
      "createDefaultAttachTarget",
      "createOpenTuiSubagentPaneManager",
      "getLastLifecycleOpenTarget",
      "resolveConnection",
    ]) {
      expect(Object.keys(exports)).not.toContain(removed);
    }
  });

  test("loads the published TUI plugin without a browser global", async () => {
    const child = Bun.spawn(
      [
        "bun",
        "-e",
        'const tui = await import("@yohi/sibyl/tui"); if (typeof tui.default.tui !== "function") process.exit(1);',
      ],
      {
        cwd: process.cwd(),
        stderr: "pipe",
        env: {
          ...process.env,
          SIBYL_OBSERVER_ENABLED: undefined,
          SIBYL_SUBAGENT_ENABLED: undefined,
          OPENCODE_SERVER_URL: undefined,
        },
      },
    );

    expect(await child.exited).toBe(0);
    expect(await new Response(child.stderr).text()).toBe("");
  });

  test("keeps the TUI bundle Observer-only", async () => {
    const bundle = await Bun.file(new URL("../dist/tui.js", import.meta.url)).text();
    const rollupConfig = await Bun.file(new URL("../rollup.config.js", import.meta.url)).text();

    expect(bundle).toContain("sidebar_content");
    expect(bundle).not.toMatch(/sibyl\.open|sibyl\.split|opencode attach|Bun\.Terminal|node-pty/);
    expect(bundle.length, "Published TUI bundle size exceeds expected limit").toBeLessThan(100_000);
    expect(rollupConfig).toMatch(/external/);
  });

  test("renders a hydrated direct child through the published sidebar slot", async () => {
    const child = Bun.spawn(
      [
        "bun",
        "--preload",
        "@opentui/solid/preload",
        "-e",
        `import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
const { attachSubagentIntegration, createTuiPlugin } = await import("./dist/tui.js");
const color = RGBA.fromHex("#ffffff");
const theme = { error: color, warning: color, info: color, success: color, text: color, textMuted: color, backgroundPanel: color };
const source = { start() {}, async stop() {}, onEvent() { return () => {}; }, onReconnectRequired() { return () => {}; } };
const reader = {
  async readParent(parentSessionId) {
    return {
      parentSessionId,
      children: [{
        session: { id: "child-1", parentSessionId, createdAt: 1, updatedAt: 2 },
        status: "busy",
        messages: [{ id: "message-1", sessionId: "child-1", role: "user", createdAt: 1, agentName: "explore" }],
        parts: [],
      }],
      omittedCount: 0,
      ignoredSessionIdsSeen: [],
    };
  },
  async readMessage() { return { parts: [] }; },
};
const registrations = [];
const disposers = [];
let handle;
const api = {
  client: {},
  event: { on() { return () => {}; } },
  state: { config: {}, session: { get() {}, messages() { return []; }, status() {} }, part() { return []; } },
  theme: { current: theme },
  slots: { register(plugin) { registrations.push(plugin); return "registration-1"; } },
  lifecycle: { signal: new AbortController().signal, onDispose(fn) { disposers.push(fn); return () => {}; } },
};
const tui = createTuiPlugin({
  env: { SIBYL_OBSERVER_ENABLED: "true" },
  attach: async (runtime, config) => {
    handle = await attachSubagentIntegration(runtime, config, { eventSource: source, snapshotReader: reader });
    return handle;
  },
});
await Reflect.apply(tui, undefined, [api, undefined, undefined]);
const slot = registrations[0]?.slots.sidebar_content;
if (!slot) throw new Error("Missing sidebar_content slot");
const setup = await testRender(() => slot({ theme: api.theme }, { session_id: "parent-1" }), { width: 40, height: 8 });
await setup.renderOnce();
await Promise.resolve();
await Promise.resolve();
await setup.renderOnce();
const frame = setup.captureCharFrame();
setup.renderer.destroy();
await handle.stop();
if (!frame.includes("explore")) throw new Error("Missing child agent in frame");
if (!frame.includes("BUSY")) throw new Error("Missing child status in frame");`,
      ],
      {
        cwd: process.cwd(),
        stderr: "pipe",
        env: {
          ...process.env,
          SIBYL_OBSERVER_ENABLED: undefined,
          SIBYL_SUBAGENT_ENABLED: undefined,
          OPENCODE_SERVER_URL: undefined,
        },
      },
    );

    expect(await child.exited).toBe(0);
    expect(await new Response(child.stderr).text()).toBe("");
  });
});
