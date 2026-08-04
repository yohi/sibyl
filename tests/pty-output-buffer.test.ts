import { describe, expect, test } from "bun:test";
import { PtyOutputBuffer } from "../src/pty-output-buffer";

describe("PtyOutputBuffer", () => {
  test("preserves a line split across PTY data chunks", () => {
    // Given
    const output = new PtyOutputBuffer(1_000);

    // When
    output.append("hel");
    output.append("lo\n");

    // Then
    expect(output.text()).toBe("hello\n");
  });

  test.each([
    ["a CSI sequence", ["before\x1b[", "31mred\x1b[0", "mafter\n"], "beforeredafter\n"],
    [
      "an OSC sequence",
      ["left\x1b]8;;https://example.com\x1b", "\\label\x1b]8;;\x1b\\right\n"],
      "leftlabelright\n",
    ],
    [
      "split string controls and non-rendering C0 controls",
      ["before\x1bPprivate\x1b", "\\after\r\b\x07\n"],
      "beforeafter\n",
    ],
    [
      "a split 8-bit C1 string control",
      ["before\u0090private", " payload\u009cafter\n"],
      "beforeafter\n",
    ],
    [
      "a C1 string control terminated by ESC-backslash",
      ["before\u0090private", " payload\x1b\\after\n"],
      "beforeafter\n",
    ],
    [
      "an ESC string control terminated by a C1 ST",
      ["before\x1bPprivate", " payload\u009cafter\n"],
      "beforeafter\n",
    ],
  ])("removes %s split across PTY data chunks", (_, chunks, expected) => {
    // Given
    const output = new PtyOutputBuffer(1_000);

    // When
    for (const chunk of chunks) {
      output.append(chunk);
    }

    // Then
    expect(output.text()).toBe(expected);
  });
  test("processes 1,000 PTY chunks within a performance smoke budget", () => {
    const output = new PtyOutputBuffer(1_000);

    for (let index = 0; index < 1_000; index += 1) {
      output.append(`line-${index}\n`);
    }

    expect(output.text()).toContain("line-999");
  });

  test("bounds an unterminated output line", () => {
    // Given
    const output = new PtyOutputBuffer(2, 8);

    // When
    output.append("0123456789abcdef");

    // Then
    expect(output.text()).toBe("89abcdef");
  });

  test("rejects maxPendingLineLength of 0 to prevent unbounded growth", () => {
    expect(() => new PtyOutputBuffer(2, 0)).toThrow("maxPendingLineLength must be positive, got 0");
  });
});
