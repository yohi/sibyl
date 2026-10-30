import { expect, test } from "bun:test";
import manifest from "../package.json";

test("declares the OpenCode V2 host and SDK contract", () => {
  expect(manifest.engines.opencode).toBe(">=2.1.4 <3");
  expect(manifest.devEngines.runtime.version).toBe("2.1.4");
  expect(Reflect.get(manifest.devDependencies, "@opencode/plugin")).toBe("2.1.4");
  expect(Reflect.get(manifest.devDependencies, "@opencode/client")).toBe("2.1.4");
  expect(Reflect.get(manifest.peerDependencies, "@opencode-ai/plugin")).toBeUndefined();
  expect(manifest.exports["."].import).toBe("./dist/index.js");
  expect(manifest.exports["./tui"].import).toBe("./dist/tui.js");
});
