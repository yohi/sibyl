export const DEFAULT_SHELL_COMMAND =
  process.platform === "win32" ? "cmd.exe" : process.env.SHELL || "sh";
