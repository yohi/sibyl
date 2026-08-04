import { STRING_CONTROL_ESC_STARTS, findStringControlStart, stripAnsi } from "./ansi-strip.js";

const MAX_PENDING_CONTROL_SEQUENCE_LENGTH = 1024;
const MAX_PENDING_LINE_LENGTH_DEFAULT = 100_000;

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
    const code = text.codePointAt(index) ?? 0;
    if (code >= 0x40 && code <= 0x7e) return index + 1;
  }
  return start;
}

function advancePastC1Csi(text: string, start: number): number {
  for (let index = start + 1; index < text.length; index += 1) {
    const code = text.codePointAt(index) ?? 0;
    if (code >= 0x40 && code <= 0x7e) return index + 1;
  }
  return start;
}

function dispatchEscSequence(
  text: string,
  start: number,
): { nextCursor?: number; incompleteStart?: number } {
  const kind = text[start + 1];
  if (kind === undefined) return { incompleteStart: start };

  if (STRING_CONTROL_ESC_STARTS.includes(`\x1b${kind}`)) {
    const nextCursor = advancePastEscStringControl(text, start);
    if (nextCursor === undefined) return { incompleteStart: start };
    return { nextCursor };
  }

  if (kind === "[") {
    const nextCursor = advancePastCsi(text, start);
    if (nextCursor === start) return { incompleteStart: start };
    return { nextCursor };
  }

  return { nextCursor: start + 2 };
}

function findIncompleteEscapeStart(text: string): number | undefined {
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf("\x1b", cursor);
    const c1StartCandidate = findStringControlStart(text, cursor);
    const c1Start = Number.isFinite(c1StartCandidate) ? c1StartCandidate : undefined;
    const c1CsiStart = text.indexOf("\x9b", cursor);

    if (
      c1CsiStart !== -1 &&
      (start === -1 || c1CsiStart < start) &&
      (c1Start === undefined || c1CsiStart < c1Start)
    ) {
      const nextCursor = advancePastC1Csi(text, c1CsiStart);
      if (nextCursor === c1CsiStart) return c1CsiStart;
      cursor = nextCursor;
      continue;
    }

    if (c1Start !== undefined && (start === -1 || c1Start < start)) {
      const nextCursor = advancePastC1StringControl(text, c1Start);
      if (nextCursor === undefined) return c1Start;
      cursor = nextCursor;
      continue;
    }
    if (start === -1) return undefined;

    const result = dispatchEscSequence(text, start);
    if (result.incompleteStart !== undefined) return result.incompleteStart;
    if (result.nextCursor !== undefined) cursor = result.nextCursor;
  }

  return undefined;
}

/** Keeps the trailing `maxLength` characters, dropping any leading overflow.
 * Used to bound a single pending line or completed line segment so rendering
 * still shows the most recently received output.
 */
function truncateFront(line: string, maxLength: number): string {
  return line.length > maxLength ? line.slice(line.length - maxLength) : line;
}

export class PtyOutputBuffer {
  private readonly lines: string[] = [];
  private pendingControlSequence = "";
  private pendingLine = "";

  constructor(
    private readonly maxLines: number,
    private readonly maxPendingLineLength = MAX_PENDING_LINE_LENGTH_DEFAULT,
  ) {
    if (maxPendingLineLength <= 0) {
      throw new Error(`maxPendingLineLength must be positive, got ${maxPendingLineLength}`);
    }
  }

  append(chunk: string): string {
    const raw = this.pendingControlSequence + chunk;
    const incompleteStart = findIncompleteEscapeStart(raw);
    let complete: string;
    if (incompleteStart === undefined) {
      complete = raw;
      this.pendingControlSequence = "";
    } else {
      const pending = raw.slice(incompleteStart);
      if (pending.length > MAX_PENDING_CONTROL_SEQUENCE_LENGTH) {
        complete = raw.slice(0, incompleteStart);
        this.pendingControlSequence =
          pending[0] === "\x1b" ? pending.slice(0, 2) : (pending[0] ?? "");
      } else {
        complete = raw.slice(0, incompleteStart);
        this.pendingControlSequence = pending;
      }
    }

    const parts = (this.pendingLine + stripAnsi(complete)).split(/\r?\n/);
    this.pendingLine = parts.pop() ?? "";
    if (this.pendingLine.length > this.maxPendingLineLength) {
      // Truncate from the front to keep the most recent output visible for rendering,
      // unlike pendingControlSequence which is fully discarded because incomplete ANSI
      // sequences cannot be reliably interpreted.
      this.pendingLine = truncateFront(this.pendingLine, this.maxPendingLineLength);
    }

    for (let i = 0; i < parts.length; i += 1) {
      parts[i] = truncateFront(parts[i], this.maxPendingLineLength);
    }
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
