import { stripAnsi } from "./ansi-strip.js";

function findIncompleteEscapeStart(text: string): number | undefined {
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf("\x1b", cursor);
    if (start === -1) return undefined;

    const kind = text[start + 1];
    if (kind === undefined) return start;

    if (kind === "]" || kind === "P" || kind === "X" || kind === "^" || kind === "_") {
      const bel = text.indexOf("\x07", start + 2);
      const stringTerminator = text.indexOf("\x1b\\", start + 2);
      const acceptsBel = kind === "]";
      if (stringTerminator === -1 && (!acceptsBel || bel === -1)) return start;
      cursor = Math.min(
        acceptsBel && bel !== -1 ? bel + 1 : Number.POSITIVE_INFINITY,
        stringTerminator === -1 ? Number.POSITIVE_INFINITY : stringTerminator + 2,
      );
      continue;
    }

    if (kind === "[") {
      let completed = false;
      for (let index = start + 2; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code >= 0x40 && code <= 0x7e) {
          cursor = index + 1;
          completed = true;
          break;
        }
      }
      if (!completed) return start;
      continue;
    }

    cursor = start + 2;
  }

  return undefined;
}

/** Retains incomplete terminal control sequences and lines between PTY data events. */
export class PtyOutputBuffer {
  private readonly lines: string[] = [];
  private pendingControlSequence = "";
  private pendingLine = "";

  constructor(private readonly maxLines: number) {}

  append(chunk: string): string {
    const raw = this.pendingControlSequence + chunk;
    const incompleteStart = findIncompleteEscapeStart(raw);
    const complete = incompleteStart === undefined ? raw : raw.slice(0, incompleteStart);
    this.pendingControlSequence = incompleteStart === undefined ? "" : raw.slice(incompleteStart);

    const parts = (this.pendingLine + stripAnsi(complete)).split(/\r?\n/);
    this.pendingLine = parts.pop() ?? "";
    this.lines.push(...parts);
    if (this.lines.length >= this.maxLines) {
      this.lines.splice(0, this.lines.length - this.maxLines + 1);
    }

    return this.text();
  }

  text(): string {
    return [...this.lines, this.pendingLine].join("\n");
  }
}
