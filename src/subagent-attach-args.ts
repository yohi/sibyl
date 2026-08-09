import type { PtyOptions } from "./types.js";
import type { AttachTarget } from "./subagent-types.js";
import {
  SubagentValidationError,
  validateServerUrl,
  validateSessionId,
} from "./subagent-validation.js";

export interface BuildAttachPtyOptionsArgs {
  readonly target: AttachTarget;
  readonly serverUrl: string;
  readonly directory: string;
  readonly username?: string | undefined;
  readonly password?: string | undefined;
}

export function isWindows(): boolean {
  return process.platform === "win32";
}

export function resolveOpencodeCommand(): string {
  return isWindows() ? "opencode.cmd" : "opencode";
}

export function buildAttachPtyOptions(args: BuildAttachPtyOptionsArgs): PtyOptions {
  if (!validateServerUrl(args.serverUrl)) throw new SubagentValidationError("server URL");
  if (!validateSessionId(args.target.sessionId)) throw new SubagentValidationError("session ID");
  if (args.directory.length === 0) throw new SubagentValidationError("directory");

  const environment: Record<string, string> = {};
  if (args.username !== undefined) environment.OPENCODE_SERVER_USERNAME = args.username;
  if (args.password !== undefined) environment.OPENCODE_SERVER_PASSWORD = args.password;
  return {
    command: resolveOpencodeCommand(),
    args: [
      "attach",
      args.serverUrl,
      "--session",
      args.target.sessionId,
      "--dir",
      args.directory,
      "--mini",
    ],
    cwd: args.directory,
    ...(Object.keys(environment).length > 0 ? { env: environment } : {}),
  };
}
