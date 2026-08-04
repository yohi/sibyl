import { describe, expect, test } from "bun:test";
import { stripAnsi } from "../src/ansi-strip";

describe("stripAnsi", () => {
  test("removes color SGR sequences", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  test("removes cursor movement sequences", () => {
    expect(stripAnsi("\x1b[2Kline")).toBe("line");
  });

  test("removes BEL-terminated OSC titles", () => {
    expect(stripAnsi("\x1b]0;Sibyl\x07ready")).toBe("ready");
  });

  test("removes ST-terminated OSC hyperlinks while preserving their label", () => {
    expect(stripAnsi("\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\")).toBe("link");
  });

  test("removes 8-bit C1 string controls together with their payload", () => {
    expect(stripAnsi("before\u0090private\u009cafter")).toBe("beforeafter");
  });

  test("removes an OSC sequence split across received chunks after buffering", () => {
    const chunks = ["before\x1b]0;title", "\x07after"];
    expect(stripAnsi(chunks.join(""))).toBe("beforeafter");
  });

  test("handles many unterminated OSC prefixes without excessive backtracking", () => {
    const text = "\x1b]0;title".repeat(100_000);
    const startedAt = performance.now();

    expect(stripAnsi(text)).toBe("0;title".repeat(100_000));
    expect(performance.now() - startedAt).toBeLessThan(5_000);
  });

  test("keeps plain text", () => {
    expect(stripAnsi("hello")).toBe("hello");
  });
});
