const OSC_PATTERN = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;
const ANSI_PATTERN =
  /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\]|\^[\\@A-Z[\]^_`a-z{|}~]|_[\\\]^_`a-z{|}~]|\*|[\x80-\x9f])/g;

export function stripAnsi(text: string): string {
  return text.replace(OSC_PATTERN, "").replace(ANSI_PATTERN, "");
}
