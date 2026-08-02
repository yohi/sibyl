const ANSI_PATTERN =
  /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\]|\^[\\@A-Z[\]^_`a-z{|}~]|_[\\\]^_`a-z{|}~]|\*|[\x80-\x9f])/g; // NOSONAR - ESC is required to remove ANSI sequences.
const NON_RENDERING_C0_PATTERN = /[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g;

function stripStringControls(text: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf("\x1b]", cursor);
    const dcs = text.indexOf("\x1bP", cursor);
    const sos = text.indexOf("\x1bX", cursor);
    const pm = text.indexOf("\x1b^", cursor);
    const apc = text.indexOf("\x1b_", cursor);
    const starts = [start, dcs, sos, pm, apc].filter((index) => index !== -1);
    const controlStart = Math.min(...starts);
    if (!Number.isFinite(controlStart)) return result + text.slice(cursor);

    result += text.slice(cursor, controlStart);
    const isOsc = text[controlStart + 1] === "]";
    let terminator = controlStart + 2;
    while (terminator < text.length) {
      if (isOsc && text[terminator] === "\x07") {
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
  return stripStringControls(text).replace(ANSI_PATTERN, "").replace(NON_RENDERING_C0_PATTERN, "");
}
