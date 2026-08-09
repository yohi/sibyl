import { describe, expect, test } from "bun:test";
import {
  formatSubagentError,
  sanitizeError,
  sanitizeSessionId,
  truncate,
} from "../src/subagent-logger";

describe("subagent logger helpers", () => {
  test("sanitizes session IDs to their first four characters", () => {
    expect(sanitizeSessionId("ses-123456")).toBe("ses-…");
  });

  test("masks valid session IDs shorter than five characters", () => {
    for (const sessionId of ["a", "ab", "abc", "abcd"]) {
      expect(sanitizeSessionId(sessionId)).toBe("[redacted]");
    }
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

  test("redacts bearer tokens from errors and formatted errors", () => {
    const token = "secret-bearer-token";
    const error = `request Authorization: Bearer ${token}`;

    expect(sanitizeError("request authorization=secret-key-token")).toBe(
      "request authorization=[redacted]",
    );
    expect(sanitizeError(error)).toBe("request Authorization: Bearer [redacted]");
    expect(formatSubagentError("request", error)).toBe(
      "[subagent] request: request Authorization: Bearer [redacted]",
    );
    expect(sanitizeError(error)).not.toContain(token);
    expect(formatSubagentError("request", error)).not.toContain(token);
  });
});
