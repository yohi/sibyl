import { describe, expect, test } from "bun:test";
import {
  parseObserverBoolean,
  parseObserverInteger,
  validateObserverCapacity,
} from "../src/subagent-validation";

describe("observer validation", () => {
  test.each([
    ["maxVisibleSubagents", 1, 1],
    ["maxVisibleSubagents", 8, 8],
    ["maxTrackedSubagents", 8, 8],
    ["maxTrackedSubagents", 256, 256],
    ["activityLimit", 1, 1],
    ["activityLimit", 20, 20],
    ["idleRetentionMs", 0, 0],
    ["idleRetentionMs", 3_600_000, 3_600_000],
  ] as const)("accepts %s=%p", (name, value, expected) => {
    expect(parseObserverInteger(name, value, false)).toBe(expected);
    expect(parseObserverInteger(name, String(value), true)).toBe(expected);
  });

  test.each([
    ["enabled", true, "true", "1"],
    ["showModel", false, "false", "0"],
  ] as const)("accepts strict boolean forms for %s", (name, typed, word, numeric) => {
    expect(parseObserverBoolean(name, typed, false)).toBe(typed);
    expect(parseObserverBoolean(name, word, true)).toBe(typed);
    expect(parseObserverBoolean(name, numeric, true)).toBe(typed);
  });

  test.each(["yes", "TRUE", " false ", 1, null] as const)(
    "rejects non-contract boolean %p",
    (value) => {
      expect(() => parseObserverBoolean("enabled", value, typeof value === "string")).toThrow(
        "Invalid observer enabled",
      );
    },
  );

  test.each([
    ["maxVisibleSubagents", 0],
    ["maxVisibleSubagents", 9],
    ["maxTrackedSubagents", 7],
    ["maxTrackedSubagents", 257],
    ["activityLimit", 0],
    ["activityLimit", 21],
    ["idleRetentionMs", -1],
    ["idleRetentionMs", 3_600_001],
    ["activityLimit", 2.5],
    ["activityLimit", "2.5"],
  ] as const)("rejects %s=%p", (name, value) => {
    expect(() => parseObserverInteger(name, value, typeof value === "string")).toThrow(
      `Invalid observer ${name}`,
    );
  });

  test("enforces tracked capacity at or above visible capacity", () => {
    expect(() => validateObserverCapacity(8, 7)).toThrow("Invalid observer maxTrackedSubagents");
    expect(() => validateObserverCapacity(8, 8)).not.toThrow();
    expect(() => validateObserverCapacity(1, 256)).not.toThrow();
  });
});
