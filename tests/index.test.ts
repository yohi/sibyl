import { describe, expect, test } from "bun:test";

describe("server-safe package entrypoint", () => {
  test("exports core modules without UI components", async () => {
    const exports = await import("../src/index");

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
});
