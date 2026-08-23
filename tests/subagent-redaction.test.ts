import { describe, expect, test } from "bun:test";
import { redactAndTruncate } from "../src/subagent-redaction";

describe("observer redaction", () => {
  test.each([
    ["authorization=topsecret", "authorization=[redacted]"],
    ['password: "topsecret"', "password: [redacted]"],
    ["Bearer eyJhbGciOiJIUzI1NiJ9.secret.signature", "Bearer [redacted]"],
    ["Basic YWxpY2U6c2VjcmV0", "Basic [redacted]"],
    ["token=ghp_1234567890abcdefgh", "token=[redacted]"],
    ["OPENAI_API_KEY=sk-1234567890abcdefgh", "OPENAI_API_KEY=[redacted]"],
  ] as const)("redacts %s", (input, expected) => {
    expect(redactAndTruncate(input, 200)).toBe(expected);
  });

  test("redacts before truncation", () => {
    const secret = "sk-1234567890abcdefghijklmnopqrstuvwxyz";
    const fullyRedacted = "prefix [redacted] suffix";
    const output = redactAndTruncate(`prefix ${secret} suffix`, 18);

    expect(output).toBe(`${fullyRedacted.slice(0, 17)}…`);
    expect(output).not.toContain(secret.slice(0, 8));
  });
});
