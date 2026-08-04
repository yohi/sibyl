const ANSI_PATTERN =
  /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\]|\^[\\@A-Z[\]^_`a-z{|}~]|_[\\\]^_`a-z{|}~]|\*|[\x80-\x9f])/g; // NOSONAR - ESC is required to remove ANSI sequences.
const C1_CSI_PATTERN = /\x9b[0-?]*[ -/]*[@-~]/g;
const NON_RENDERING_C0_PATTERN = /[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g;
const NON_RENDERING_C1_PATTERN = /[\x80-\x9f]/g;

export const STRING_CONTROL_ESC_STARTS = ["\x1b]", "\x1bP", "\x1bX", "\x1b^", "\x1b_"];
export const STRING_CONTROL_C1_STARTS = ["\x9d", "\x90", "\x98", "\x9e", "\x9f"];
export const STRING_CONTROL_STARTS = [...STRING_CONTROL_ESC_STARTS, ...STRING_CONTROL_C1_STARTS];

const STRING_CONTROL_START_PATTERN = /\u001b[\]PX^_]|[\u0090\u0098\u009d\u009e\u009f]/g; // NOSONAR - Control characters needed for ANSI sequence stripping.

export function findStringControlStart(text: string, cursor: number): number {
  STRING_CONTROL_START_PATTERN.lastIndex = cursor;
  const match = STRING_CONTROL_START_PATTERN.exec(text);
  return match !== null ? match.index : Number.POSITIVE_INFINITY;
}

function advancePastStringControlTerminator(
  text: string,
  controlStart: number,
): number | undefined {
  const isC1 = (text.codePointAt(controlStart) ?? 0) >= 0x80;
  const isOsc = isC1 ? text[controlStart] === "\x9d" : text[controlStart + 1] === "]";
  const searchStart = controlStart + (isC1 ? 1 : 2);

  for (let index = searchStart; index < text.length; index += 1) {
    if (isOsc && text[index] === "\x07") return index + 1;
    if (text[index] === "\x9c") return index + 1;
    if (text[index] === "\x1b" && text[index + 1] === "\\") return index + 2;
  }

  return undefined;
}

function stripStringControls(text: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const controlStart = findStringControlStart(text, cursor);
    if (!Number.isFinite(controlStart)) return result + text.slice(cursor);

    result += text.slice(cursor, controlStart);
    const nextCursor = advancePastStringControlTerminator(text, controlStart);
    if (nextCursor === undefined) return result + text.slice(controlStart);
    cursor = nextCursor;
  }

  return result;
}

export function stripAnsi(text: string): string {
  return stripStringControls(text)
    .replace(ANSI_PATTERN, "")
    .replace(C1_CSI_PATTERN, "")
    .replace(NON_RENDERING_C0_PATTERN, "")
    .replace(NON_RENDERING_C1_PATTERN, "");
}
