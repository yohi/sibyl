import { describe, expect, test } from "bun:test";

describe("published package entrypoints", () => {
  test("exports observer-safe core modules without legacy pane integration", async () => {
    const exports = await import("../dist/index.js");
    expect(Object.keys(exports)).toEqual(
      expect.arrayContaining([
        "DEFAULT_OBSERVER_CONFIG",
        "SubagentRegistry",
        "SubagentValidationError",
        "V2EventSource",
        "createV2SnapshotReader",
        "normalizeRuntimeStatus",
        "redactAndTruncate",
        "resolveObserverConfig",
        "safeToolName",
      ]),
    );
    for (const name of [
      "OpenTuiPaneBackend",
      "SubagentLifecycleManager",
      "SubagentPaneAdapter",
      "buildAttachPtyOptions",
    ]) {
      expect(Object.keys(exports)).not.toContain(name);
    }
  });

  test("loads the V2 TUI plugin definition", async () => {
    const child = Bun.spawn(
      [
        "bun",
        "--conditions=browser",
        "--preload",
        "@opentui/solid/preload",
        "-e",
        'const tui = await import("@yohi/sibyl/tui"); if (tui.default.id !== "oh-my-opencode.sibyl" || typeof tui.default.setup !== "function") process.exit(1);',
      ],
      { cwd: process.cwd(), stderr: "pipe" },
    );
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stderr).text()).toBe("");
  });

  test("keeps the TUI bundle observer-only", async () => {
    const bundle = await Bun.file(new URL("../dist/tui.js", import.meta.url)).text();
    expect(bundle).toContain("sidebar.content");
    expect(bundle).not.toMatch(
      /sibyl\.open|sibyl\.split|opencode attach|Bun\.Terminal|node-pty|@opencode-ai\//,
    );
    expect(bundle.length).toBeLessThan(100_000);
  });

  test("keeps framework rendering out of the root core bundle", async () => {
    const bundle = await Bun.file(new URL("../dist/index.js", import.meta.url)).text();
    expect(bundle).not.toMatch(/@opentui\/|@opencode\/plugin\/tui|solid-js/);
  });

  test("excludes stale V1 artifacts from the published distribution", async () => {
    expect(await Bun.file(new URL("../dist/server.js", import.meta.url)).exists()).toBe(false);
    expect(
      await Bun.file(new URL("../dist/integrated-sidebar.d.ts", import.meta.url)).exists(),
    ).toBe(false);
  });
});
