import {
  parseObserverBoolean,
  parseObserverInteger,
  validateObserverCapacity,
} from "./subagent-validation.js";
import type { ObserverBooleanName, ObserverIntegerName } from "./subagent-validation.js";

export interface ObserverConfig {
  readonly enabled: boolean;
  readonly maxVisibleSubagents: number;
  readonly maxTrackedSubagents: number;
  readonly activityLimit: number;
  readonly idleRetentionMs: number;
  readonly showModel: boolean;
  readonly showProvider: boolean;
  readonly showLatestText: boolean;
  readonly showReasoningSummary: boolean;
}

export interface ObserverConfigInput {
  readonly enabled?: unknown;
  readonly maxVisibleSubagents?: unknown;
  readonly maxTrackedSubagents?: unknown;
  readonly activityLimit?: unknown;
  readonly idleRetentionMs?: unknown;
  readonly showModel?: unknown;
  readonly showProvider?: unknown;
  readonly showLatestText?: unknown;
  readonly showReasoningSummary?: unknown;
}

export interface ObserverPluginOptions {
  readonly observer?: ObserverConfigInput;
}

export interface ObserverConfigResolution {
  readonly config: ObserverConfig;
  readonly legacySettingsDetected: boolean;
}

export const DEFAULT_OBSERVER_CONFIG: ObserverConfig = {
  enabled: false,
  maxVisibleSubagents: 8,
  maxTrackedSubagents: 64,
  activityLimit: 5,
  idleRetentionMs: 300_000,
  showModel: true,
  showProvider: true,
  showLatestText: true,
  showReasoningSummary: true,
};

const OBSERVER_ENV = {
  enabled: "SIBYL_OBSERVER_ENABLED",
  maxVisibleSubagents: "SIBYL_OBSERVER_MAX_VISIBLE_SUBAGENTS",
  maxTrackedSubagents: "SIBYL_OBSERVER_MAX_TRACKED_SUBAGENTS",
  activityLimit: "SIBYL_OBSERVER_ACTIVITY_LIMIT",
  idleRetentionMs: "SIBYL_OBSERVER_IDLE_RETENTION_MS",
  showModel: "SIBYL_OBSERVER_SHOW_MODEL",
  showProvider: "SIBYL_OBSERVER_SHOW_PROVIDER",
  showLatestText: "SIBYL_OBSERVER_SHOW_LATEST_TEXT",
  showReasoningSummary: "SIBYL_OBSERVER_SHOW_REASONING_SUMMARY",
} as const satisfies Record<keyof ObserverConfig, string>;

const LEGACY_PLUGIN_KEYS = ["enabled", "maxPanes", "serverUrl", "directory"] as const;
const LEGACY_ENV_KEYS = new Set([
  "OPENCODE_SERVER_URL",
  "OPENCODE_PROJECT_DIR",
  "OPENCODE_SERVER_USERNAME",
  "OPENCODE_SERVER_PASSWORD",
]);

type ConfigRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): ConfigRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function recordValue(record: ConfigRecord | undefined, key: string): unknown {
  return record === undefined ? undefined : record[key];
}

function hasOwn(record: ConfigRecord | undefined, key: string): boolean {
  return record !== undefined && Object.hasOwn(record, key);
}

function observerRecord(value: unknown): ConfigRecord | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Invalid observer configuration");
  return value;
}

function readHostObserver(hostConfig: unknown): ConfigRecord | undefined {
  const root = asRecord(hostConfig);
  const sibyl = asRecord(recordValue(root, "sibyl"));
  return observerRecord(recordValue(sibyl, "observer"));
}

function hasLegacySettings(
  pluginOptions: ConfigRecord | undefined,
  hostConfig: unknown,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (LEGACY_PLUGIN_KEYS.some((key) => hasOwn(pluginOptions, key))) return true;

  const root = asRecord(hostConfig);
  const sibyl = asRecord(recordValue(root, "sibyl"));
  const akane = asRecord(recordValue(root, "akane"));
  const experimental = asRecord(recordValue(akane, "experimental"));
  const watchdog = asRecord(recordValue(experimental, "watchdog"));

  if (hasOwn(sibyl, "subagentDisplay") || hasOwn(watchdog, "subagentDisplay")) return true;

  return Object.keys(env).some(
    (key) => key.startsWith("SIBYL_SUBAGENT_") || LEGACY_ENV_KEYS.has(key),
  );
}

function selectValue(
  environment: Readonly<Record<string, string | undefined>>,
  environmentKey: string,
  plugin: ConfigRecord | undefined,
  host: ConfigRecord | undefined,
  name: keyof ObserverConfig,
): { readonly value: unknown; readonly fromEnvironment: boolean } {
  const environmentValue = environment[environmentKey];
  if (environmentValue !== undefined) {
    return { value: environmentValue, fromEnvironment: true };
  }
  const pluginValue = recordValue(plugin, name);
  if (pluginValue !== undefined) return { value: pluginValue, fromEnvironment: false };
  const hostValue = recordValue(host, name);
  if (hostValue !== undefined) return { value: hostValue, fromEnvironment: false };
  return { value: DEFAULT_OBSERVER_CONFIG[name], fromEnvironment: false };
}

function readBoolean(
  environment: Readonly<Record<string, string | undefined>>,
  environmentKey: string,
  plugin: ConfigRecord | undefined,
  host: ConfigRecord | undefined,
  name: ObserverBooleanName,
): boolean {
  const selected = selectValue(environment, environmentKey, plugin, host, name);
  return parseObserverBoolean(name, selected.value, selected.fromEnvironment);
}

function readInteger(
  environment: Readonly<Record<string, string | undefined>>,
  environmentKey: string,
  plugin: ConfigRecord | undefined,
  host: ConfigRecord | undefined,
  name: ObserverIntegerName,
): number {
  const selected = selectValue(environment, environmentKey, plugin, host, name);
  return parseObserverInteger(name, selected.value, selected.fromEnvironment);
}

export function resolveObserverConfig(args: {
  readonly pluginOptions?: unknown;
  readonly hostConfig: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): ObserverConfigResolution {
  const pluginOptions =
    args.pluginOptions === undefined
      ? undefined
      : isRecord(args.pluginOptions)
        ? args.pluginOptions
        : (() => {
            throw new Error("Invalid observer configuration");
          })();
  const pluginObserver = observerRecord(recordValue(pluginOptions, "observer"));
  const hostObserver = readHostObserver(args.hostConfig);

  const config: ObserverConfig = {
    enabled: readBoolean(args.env, OBSERVER_ENV.enabled, pluginObserver, hostObserver, "enabled"),
    maxVisibleSubagents: readInteger(
      args.env,
      OBSERVER_ENV.maxVisibleSubagents,
      pluginObserver,
      hostObserver,
      "maxVisibleSubagents",
    ),
    maxTrackedSubagents: readInteger(
      args.env,
      OBSERVER_ENV.maxTrackedSubagents,
      pluginObserver,
      hostObserver,
      "maxTrackedSubagents",
    ),
    activityLimit: readInteger(
      args.env,
      OBSERVER_ENV.activityLimit,
      pluginObserver,
      hostObserver,
      "activityLimit",
    ),
    idleRetentionMs: readInteger(
      args.env,
      OBSERVER_ENV.idleRetentionMs,
      pluginObserver,
      hostObserver,
      "idleRetentionMs",
    ),
    showModel: readBoolean(
      args.env,
      OBSERVER_ENV.showModel,
      pluginObserver,
      hostObserver,
      "showModel",
    ),
    showProvider: readBoolean(
      args.env,
      OBSERVER_ENV.showProvider,
      pluginObserver,
      hostObserver,
      "showProvider",
    ),
    showLatestText: readBoolean(
      args.env,
      OBSERVER_ENV.showLatestText,
      pluginObserver,
      hostObserver,
      "showLatestText",
    ),
    showReasoningSummary: readBoolean(
      args.env,
      OBSERVER_ENV.showReasoningSummary,
      pluginObserver,
      hostObserver,
      "showReasoningSummary",
    ),
  };

  validateObserverCapacity(config.maxVisibleSubagents, config.maxTrackedSubagents);
  return {
    config,
    legacySettingsDetected: hasLegacySettings(pluginOptions, args.hostConfig, args.env),
  };
}
