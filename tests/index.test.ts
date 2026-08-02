import { describe, expect, test } from "bun:test";

describe("server-safe package entrypoint", () => {
  test("exports core modules without UI components", async () => {
    const exports = await import("../dist/index.js");

    expect(Object.keys(exports).sort()).toEqual([
      "OpenTuiPaneBackend",
      "PtyManager",
      "closePane",
      "findPane",
      "nextLeaf",
      "prevLeaf",
      "splitPane",
      "stripAnsi",
    ]);
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
      },
    );

    expect(await child.exited).toBe(0);
    expect(await new Response(child.stderr).text()).toBe("");
  });

  test("uses the shared Solid runtime in the published TUI bundle", async () => {
    const bundle = await Bun.file(new URL("../dist/tui.js", import.meta.url)).text();

    expect(bundle).toContain("from 'solid-js';");
    expect(bundle).not.toContain("function createSignal(");
  });

  test("renders PTY output and cleans up through the OpenCode Solid runtime", async () => {
    const child = Bun.spawn(
      [
        "bun",
        "--preload",
        "@opentui/solid/preload",
        "-e",
        `import "@opentui/solid/runtime-plugin-support";
import { testRender } from "@opentui/solid";
const { createTuiPlugin } = await import("./dist/tui.js");
const dataCallbacks = new Set();
const terminated = [];
const handle = {
  id: "pty-1",
  write() {},
  resize() {},
  onData(callback) { dataCallbacks.add(callback); return () => dataCallbacks.delete(callback); },
  onExit() { return () => {}; },
};
const ptyManager = {
  async spawn() { return handle; },
  async terminate(id) { terminated.push(id); },
  async terminateAll() {},
};
let route;
await createTuiPlugin(ptyManager)({
  route: { register(routes) { route = routes[0]; return () => {}; }, navigate() {} },
  keymap: { registerLayer() { return () => {}; } },
  lifecycle: { onDispose() { return () => {}; } },
});
const setup = await testRender(route.render, { width: 40, height: 8 });
await setup.renderOnce();
await Promise.resolve();
for (const callback of dataCallbacks) callback("sibyl-output\\n");
await setup.renderOnce();
const frame = setup.captureCharFrame();
setup.renderer.destroy();
await Promise.resolve();
if (!frame.includes("sibyl-output") || terminated.join(",") !== "pty-1") process.exit(1);`,
      ],
      {
        cwd: process.cwd(),
        stderr: "pipe",
      },
    );

    expect(await child.exited).toBe(0);
    expect(await new Response(child.stderr).text()).toBe("");
  });
});
