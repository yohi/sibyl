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
    const rollupConfig = await Bun.file(new URL("../rollup.config.js", import.meta.url)).text();

    expect(bundle).toMatch(/from\s*["']solid-js["']/);
    expect(bundle).not.toMatch(/\bcreateSignal\s*[=(]\s*(function|\()/);
    expect(bundle.length).toBeLessThan(50_000);
    expect(rollupConfig).toMatch(/external:\s*\[[^\]]*solid-js/);
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
const outputStartedAt = performance.now();
for (const callback of dataCallbacks) callback("sibyl-output\\n");
await setup.renderOnce();
const frame = setup.captureCharFrame();
setup.renderer.destroy();
await Promise.resolve();
if (!frame.includes("sibyl-output") || performance.now() - outputStartedAt >= 16 || terminated.join(",") !== "pty-1") process.exit(1);`,
      ],
      {
        cwd: process.cwd(),
        stderr: "pipe",
      },
    );

    expect(await child.exited).toBe(0);
    expect(await new Response(child.stderr).text()).toBe("");
  });

  test("replaces the surviving PTY session when split collapse remounts its pane", async () => {
    const child = Bun.spawn(
      [
        "bun",
        "--preload",
        "@opentui/solid/preload",
        "-e",
        `import "@opentui/solid/runtime-plugin-support";
import { testRender } from "@opentui/solid";
const { createTuiPlugin } = await import("./dist/tui.js");
let nextPtyId = 0;
const terminated = [];
const exitCallbacks = new Map();
const ptyManager = {
  async spawn() {
    const id = \`pty-\${++nextPtyId}\`;
    const callbacks = new Set();
    exitCallbacks.set(id, callbacks);
    return {
      id,
      write() {},
      resize() {},
      onData() { return () => {}; },
      onExit(callback) { callbacks.add(callback); return () => callbacks.delete(callback); },
    };
  },
  async terminate(id) {
    terminated.push(id);
    for (const callback of exitCallbacks.get(id) ?? []) callback({ exitCode: 0 });
    exitCallbacks.delete(id);
  },
  async terminateAll() {},
};
let route;
let layer;
await createTuiPlugin(ptyManager)({
  route: { register(routes) { route = routes[0]; return () => {}; }, navigate() {} },
  keymap: { registerLayer(value) { layer = value; return () => {}; } },
  lifecycle: { onDispose() { return () => {}; } },
});
const setup = await testRender(() => route.render({}), { width: 80, height: 24 });
try {
  const render = async () => {
    await setup.renderOnce();
    await Promise.resolve();
    await Promise.resolve();
  };
  const run = (name) => {
    const command = layer.commands.find((candidate) => candidate.name === name);
    if (!command) throw new Error(\`Missing command: \${name}\`);
    return command.run();
  };
  await render();
  await run("sibyl.split.horizontal");
  await render();
  if (nextPtyId !== 3) throw new Error(\`Expected 3 PTY spawns after split, received \${nextPtyId}\`);
  await run("sibyl.close");
  await render();
  if (nextPtyId !== 4) throw new Error(\`Expected remounted surviving pane to spawn pty-4, received \${nextPtyId}\`);
  if (terminated.join(",") !== "pty-1,pty-2,pty-3") throw new Error(\`Unexpected terminated PTYs: \${terminated}\`);
} finally {
  setup.renderer.destroy();
  await Promise.resolve();
}`,
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
