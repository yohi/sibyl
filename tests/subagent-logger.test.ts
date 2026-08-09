import { describe, expect, test } from "bun:test";
import { sanitizeError, sanitizeSessionId, truncate } from "../src/subagent-logger";

describe("subagent logger helpers", () => {
  test("sanitizes session IDs to their first four characters", () => {
    expect(sanitizeSessionId("ses-123456")).toBe("ses-…");
  });

  test("truncates long messages to the requested limit", () => {
    expect(truncate("x".repeat(250))).toBe(`${"x".repeat(197)}...`);
  });

  test("redacts URLs and credentials from errors", () => {
    const message = sanitizeError(new Error("request https://alice:secret@example.test/api"));
    expect(message).not.toContain("alice");
    expect(message).not.toContain("secret");
    expect(message).toContain("[redacted-url]");
  });
});
