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

  test("removes a CSI sequence split across PTY data chunks", () => {
    // Given
    const output = new PtyOutputBuffer(1_000);

    // When
    output.append("before\x1b[");
    output.append("31mred\x1b[0");
    output.append("mafter\n");

    // Then
    expect(output.text()).toBe("beforeredafter\n");
  });

  test("removes an OSC sequence split across PTY data chunks", () => {
    // Given
    const output = new PtyOutputBuffer(1_000);

    // When
    output.append("left\x1b]8;;https://example.com\x1b");
    output.append("\\label\x1b]8;;\x1b\\right\n");

    // Then
    expect(output.text()).toBe("leftlabelright\n");
  });

  test("updates the display buffer within one frame for 1,000 PTY chunks", () => {
    const output = new PtyOutputBuffer(1_000);
    const startedAt = performance.now();

    for (let index = 0; index < 1_000; index += 1) {
      output.append(`line-${index}\n`);
    }

    expect(output.text()).toContain("line-999");
    expect(performance.now() - startedAt).toBeLessThan(16);
  });
});
