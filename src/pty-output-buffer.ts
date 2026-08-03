import { STRING_CONTROL_C1_STARTS, STRING_CONTROL_ESC_STARTS, stripAnsi } from "./ansi-strip.js";

function advancePastC1StringControl(text: string, start: number): number | undefined {
  const kind = text[start];
  const bel = text.indexOf("\x07", start + 1);
  const stringTerminator = text.indexOf("\x9c", start + 1);
  const st = text.indexOf("\x1b\\", start + 1);
  const acceptsBel = kind === "\x9d";

  const end = Math.min(
    stringTerminator === -1 ? Number.POSITIVE_INFINITY : stringTerminator + 1,
    st === -1 ? Number.POSITIVE_INFINITY : st + 2,
    acceptsBel && bel !== -1 ? bel + 1 : Number.POSITIVE_INFINITY,
  );

  if (!Number.isFinite(end)) return undefined;
  return end;
}

function advancePastEscStringControl(text: string, start: number): number | undefined {
  const kind = text[start + 1];
  if (kind === undefined) return start;
  const acceptsBel = kind === "]";

  const bel = text.indexOf("\x07", start + 2);
  const stringTerminator = text.indexOf("\x9c", start + 2);
  const st = text.indexOf("\x1b\\", start + 2);

  const end = Math.min(
    stringTerminator === -1 ? Number.POSITIVE_INFINITY : stringTerminator + 1,
    st === -1 ? Number.POSITIVE_INFINITY : st + 2,
    acceptsBel && bel !== -1 ? bel + 1 : Number.POSITIVE_INFINITY,
  );

  if (!Number.isFinite(end)) return undefined;
  return end;
}

function advancePastCsi(text: string, start: number): number {
  for (let index = start + 2; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) return index + 1;
  }
  return start;
}

function findIncompleteEscapeStart(text: string): number | undefined {
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf("\x1b", cursor);
    const c1Start = STRING_CONTROL_C1_STARTS.map((control) => text.indexOf(control, cursor))
      .filter((index) => index !== -1)
      .reduce<number | undefined>(
        (first, index) => (first === undefined ? index : Math.min(first, index)),
        undefined,
      );
    if (c1Start !== undefined && (start === -1 || c1Start < start)) {
      const nextCursor = advancePastC1StringControl(text, c1Start);
      if (nextCursor === undefined) return c1Start;
      cursor = nextCursor;
      continue;
    }
    if (start === -1) return undefined;

    const kind = text[start + 1];
    if (kind === undefined) return start;

    if (STRING_CONTROL_ESC_STARTS.some((candidate) => candidate === `\x1b${kind}`)) {
      const nextCursor = advancePastEscStringControl(text, start);
      if (nextCursor === undefined) return start;
      cursor = nextCursor;
      continue;
    }

    if (kind === "[") {
      const nextCursor = advancePastCsi(text, start);
      if (nextCursor === start) return start;
      cursor = nextCursor;
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
    if (this.lines.length > this.maxLines) {
      this.lines.splice(0, this.lines.length - this.maxLines);
    }

    return this.text();
  }

  text(): string {
    return [...this.lines, this.pendingLine].join("\n");
  }
}
