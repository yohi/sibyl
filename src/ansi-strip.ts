const ANSI_PATTERN =
  /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\]|\^[\\@A-Z[\]^_`a-z{|}~]|_[\\\]^_`a-z{|}~]|\*|[\x80-\x9f])/g; // NOSONAR - ESC is required to remove ANSI sequences.
const NON_RENDERING_C0_PATTERN = /[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g;
const NON_RENDERING_C1_PATTERN = /[\x80-\x9f]/g;
const STRING_CONTROL_STARTS = [
  "\x1b]",
  "\x1bP",
  "\x1bX",
  "\x1b^",
  "\x1b_",
  "\x9d",
  "\x90",
  "\x98",
  "\x9e",
  "\x9f",
];

function stripStringControls(text: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const starts = STRING_CONTROL_STARTS.map((start) => text.indexOf(start, cursor)).filter(
      (index) => index !== -1,
    );
    const controlStart = Math.min(...starts);
    if (!Number.isFinite(controlStart)) return result + text.slice(cursor);

    result += text.slice(cursor, controlStart);
    const isC1 = text.charCodeAt(controlStart) >= 0x80;
    const isOsc = isC1 ? text[controlStart] === "\x9d" : text[controlStart + 1] === "]";
    let terminator = controlStart + (isC1 ? 1 : 2);
    while (terminator < text.length) {
      if (isOsc && text[terminator] === "\x07") {
        cursor = terminator + 1;
        break;
      }
      if (text[terminator] === "\x9c") {
        cursor = terminator + 1;
        break;
      }
      if (text[terminator] === "\x1b" && text[terminator + 1] === "\\") {
        cursor = terminator + 2;
        break;
      }
      terminator += 1;
    }

    if (terminator === text.length) return result + text.slice(controlStart);
  }

  return result;
}

export function stripAnsi(text: string): string {
  return stripStringControls(text)
    .replace(ANSI_PATTERN, "")
    .replace(NON_RENDERING_C0_PATTERN, "")
    .replace(NON_RENDERING_C1_PATTERN, "");
}
