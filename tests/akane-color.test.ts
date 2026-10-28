import { expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { agentColor } from "../src/akane-color.js";

test("accepts CSS hex colors and rejects malformed color strings", () => {
  const accent = RGBA.fromHex("#123456");
  expect(agentColor("accent", { accent })).toBe(accent);
  expect(agentColor("#abc", { accent })).toBeDefined();
  expect(agentColor("#12345", { accent })).toBeUndefined();
  expect(agentColor("#fff;red", { accent })).toBeUndefined();
});
