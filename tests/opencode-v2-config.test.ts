import { expect, test } from "bun:test";
import { resolveObserverConfig } from "../src/subagent-config";

test("V2 observer options use environment overrides", () => {
  const result = resolveObserverConfig({
    pluginOptions: { observer: { maxVisibleSubagents: 2 } },
    env: { SIBYL_OBSERVER_MAX_VISIBLE_SUBAGENTS: "3" },
  });
  expect(result.maxVisibleSubagents).toBe(3);
});

test("V2 rejects invalid selected environment values", () => {
  expect(() => resolveObserverConfig({ env: { SIBYL_OBSERVER_ENABLED: "invalid" } })).toThrow();
});
