const ANSI_PATTERN =
  /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\]|\^[\\@A-Z[\]^_`a-z{|}~]|_[\\\]^_`a-z{|}~]|\*|[\x80-\x9f])/g;

function stripOsc(text: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf("\x1b]", cursor);
    if (start === -1) return result + text.slice(cursor);

    result += text.slice(cursor, start);
    let terminator = start + 2;
    while (terminator < text.length) {
      if (text[terminator] === "\x07") {
        cursor = terminator + 1;
        break;
      }
      if (text[terminator] === "\x1b" && text[terminator + 1] === "\\") {
        cursor = terminator + 2;
        break;
      }
      terminator += 1;
    }

    if (terminator === text.length) return result + text.slice(start);
  }

  return result;
}

export function stripAnsi(text: string): string {
  return stripOsc(text).replace(ANSI_PATTERN, "");
}
