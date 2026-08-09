import type { SubagentLogger } from "./subagent-logger.js";
import { formatSubagentError } from "./subagent-logger.js";
import { parseMaxPanesValue, validateServerUrl } from "./subagent-validation.js";

export interface SubagentConfig {
  readonly enabled: boolean;
  readonly maxPanes: number;
}

export interface ResolvedConnection {
  readonly serverUrl: string;
  readonly directory: string;
  readonly username?: string | undefined;
  readonly password?: string | undefined;
}

export interface SubagentPluginOptions {
  readonly enabled?: unknown;
  readonly maxPanes?: unknown;
  readonly serverUrl?: unknown;
  readonly directory?: unknown;
}

export interface ResolveSubagentConfigArgs {
  readonly pluginOptions?: SubagentPluginOptions;
  readonly hostConfig: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly logger: SubagentLogger;
}

export interface ResolveConnectionArgs extends ResolveSubagentConfigArgs {}

export interface ResolveConnectionArgs {
  readonly pluginInput?: { readonly serverUrl?: string; readonly directory?: string };
}

type DisplayBlock = Readonly<Record<string, unknown>>;

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function nestedRecord(record: Readonly<Record<string, unknown>> | undefined, key: string) {
  return record === undefined ? undefined : asRecord(record[key]);
}

function displayBlock(hostConfig: unknown, owner: "akane" | "sibyl"): DisplayBlock {
  const root = asRecord(hostConfig);
  if (owner === "sibyl") {
    return nestedRecord(nestedRecord(root, "sibyl"), "subagentDisplay") ?? {};
  }

  const akane = nestedRecord(root, "akane");
  const experimental = nestedRecord(akane, "experimental");
  const watchdog = nestedRecord(experimental, "watchdog");
  return nestedRecord(watchdog, "subagentDisplay") ?? {};
}

function selectDefined<T>(values: readonly (T | undefined)[]): T | undefined {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;

  switch (value.toLowerCase()) {
    case "1":
    case "true":
    case "yes":
      return true;
    case "0":
    case "false":
    case "no":
      return false;
    default:
      return undefined;
  }
}

function configurationError(logger: SubagentLogger, subject: string): never {
  const error = new Error(`invalid ${subject} configuration`);
  logger.error(formatSubagentError(`invalid ${subject} configuration`, error));
  throw error;
}

export function resolveSubagentConfig(args: ResolveSubagentConfigArgs): SubagentConfig {
  const akane = displayBlock(args.hostConfig, "akane");
  const sibyl = displayBlock(args.hostConfig, "sibyl");
  const selectedEnabled = selectDefined<unknown>([
    args.env.SIBYL_SUBAGENT_ENABLED,
    args.pluginOptions?.enabled,
    akane.enabled,
    sibyl.enabled,
  ]);
  const enabled =
    selectedEnabled === undefined
      ? false
      : (parseBoolean(selectedEnabled) ?? configurationError(args.logger, "enabled"));
  const selectedMaxPanes = selectDefined<unknown>([
    args.env.SIBYL_SUBAGENT_MAX_PANES,
    args.pluginOptions?.maxPanes,
    akane.maxPanes,
    sibyl.maxPanes,
  ]);
  const rawMaxPanes =
    typeof selectedMaxPanes === "string"
      ? selectedMaxPanes.trim().length === 0
        ? Number.NaN
        : Number(selectedMaxPanes)
      : selectedMaxPanes;
  const parsedMaxPanes =
    selectedMaxPanes === undefined ? { ok: true, value: 4 } : parseMaxPanesValue(rawMaxPanes);
  if (!parsedMaxPanes.ok) return configurationError(args.logger, "maxPanes");
  return { enabled, maxPanes: parsedMaxPanes.value };
}

export function resolveConnection(args: ResolveConnectionArgs): ResolvedConnection {
  const akane = displayBlock(args.hostConfig, "akane");
  const sibyl = displayBlock(args.hostConfig, "sibyl");
  const serverUrl = selectDefined<unknown>([
    args.env.OPENCODE_SERVER_URL,
    args.pluginOptions?.serverUrl,
    akane.serverUrl,
    sibyl.serverUrl,
    args.pluginInput?.serverUrl,
  ]);
  const directory = selectDefined<unknown>([
    args.env.OPENCODE_PROJECT_DIR,
    args.pluginOptions?.directory,
    akane.directory,
    sibyl.directory,
    args.pluginInput?.directory,
  ]);
  if (typeof serverUrl !== "string" || !validateServerUrl(serverUrl)) {
    return configurationError(args.logger, "serverUrl");
  }
  if (typeof directory !== "string" || directory.length === 0) {
    return configurationError(args.logger, "directory");
  }
  return {
    serverUrl,
    directory,
    username: args.env.OPENCODE_SERVER_USERNAME,
    password: args.env.OPENCODE_SERVER_PASSWORD,
  };
}
