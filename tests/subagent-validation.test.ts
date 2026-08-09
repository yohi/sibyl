import { describe, expect, test } from "bun:test";
import {
  parseMaxPanesValue,
  validateServerUrl,
  validateSessionId,
} from "../src/subagent-validation";

describe("subagent validation", () => {
  test("accepts disabled and bounded integer pane counts", () => {
    // Given / When
    const disabled = parseMaxPanesValue(0);
    const lower = parseMaxPanesValue(1);
    const upper = parseMaxPanesValue(8);

    // Then
    expect(disabled).toEqual({ ok: true, value: 0 });
    expect(lower).toEqual({ ok: true, value: 1 });
    expect(upper).toEqual({ ok: true, value: 8 });
  });

  test.each([-1, 2.5, Number.NaN, "4", undefined, null])(
    "rejects an invalid pane count of %p",
    (value) => {
      // Given / When / Then
      expect(parseMaxPanesValue(value).ok).toBe(false);
    },
  );

  test.each([
    ["http://localhost:4096", true],
    ["https://example.test", true],
    ["ftp://example.test", false],
    ["http://alice:secret@example.test", false],
    ["https://:secret@example.test", false],
    ["not a URL", false],
    ["", false],
  ])("validates attach server URL %s", (url, expected) => {
    // Given / When / Then
    expect(validateServerUrl(url)).toBe(expected);
  });

  test.each(["ses-123", "ABC123", "a-b-c"])("accepts safe session ID %s", (id) => {
    // Given / When / Then
    expect(validateSessionId(id)).toBe(true);
  });

  test.each(["", " ", "ses_1", "ses;1", "ses/1", "ses`1"])("rejects unsafe session ID %s", (id) => {
    // Given / When / Then
    expect(validateSessionId(id)).toBe(false);
  });
});
