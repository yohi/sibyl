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

type ConfigRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(record: ConfigRecord | undefined, key: string): unknown {
  return record === undefined ? undefined : record[key];
}

function observerRecord(value: unknown): ConfigRecord | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Invalid observer configuration");
  return value;
}

function selectValue(
  environment: Readonly<Record<string, string | undefined>>,
  environmentKey: string,
  plugin: ConfigRecord | undefined,
  name: keyof ObserverConfig,
): { readonly value: unknown; readonly fromEnvironment: boolean } {
  const environmentValue = environment[environmentKey];
  if (environmentValue !== undefined) {
    return { value: environmentValue, fromEnvironment: true };
  }
  const pluginValue = recordValue(plugin, name);
  if (pluginValue !== undefined) return { value: pluginValue, fromEnvironment: false };
  return { value: DEFAULT_OBSERVER_CONFIG[name], fromEnvironment: false };
}

function readBoolean(
  environment: Readonly<Record<string, string | undefined>>,
  environmentKey: string,
  plugin: ConfigRecord | undefined,
  name: ObserverBooleanName,
): boolean {
  const selected = selectValue(environment, environmentKey, plugin, name);
  return parseObserverBoolean(name, selected.value, selected.fromEnvironment);
}

function readInteger(
  environment: Readonly<Record<string, string | undefined>>,
  environmentKey: string,
  plugin: ConfigRecord | undefined,
  name: ObserverIntegerName,
): number {
  const selected = selectValue(environment, environmentKey, plugin, name);
  return parseObserverInteger(name, selected.value, selected.fromEnvironment);
}

export function resolveObserverConfig(args: {
  readonly pluginOptions?: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): ObserverConfig {
  let pluginOptions: ConfigRecord | undefined;
  if (args.pluginOptions === undefined) {
    pluginOptions = undefined;
  } else if (isRecord(args.pluginOptions)) {
    pluginOptions = args.pluginOptions;
  } else {
    throw new Error("Invalid observer configuration");
  }
  const pluginObserver = observerRecord(recordValue(pluginOptions, "observer"));

  const config: ObserverConfig = {
    enabled: readBoolean(args.env, OBSERVER_ENV.enabled, pluginObserver, "enabled"),
    maxVisibleSubagents: readInteger(
      args.env,
      OBSERVER_ENV.maxVisibleSubagents,
      pluginObserver,
      "maxVisibleSubagents",
    ),
    maxTrackedSubagents: readInteger(
      args.env,
      OBSERVER_ENV.maxTrackedSubagents,
      pluginObserver,
      "maxTrackedSubagents",
    ),
    activityLimit: readInteger(
      args.env,
      OBSERVER_ENV.activityLimit,
      pluginObserver,
      "activityLimit",
    ),
    idleRetentionMs: readInteger(
      args.env,
      OBSERVER_ENV.idleRetentionMs,
      pluginObserver,
      "idleRetentionMs",
    ),
    showModel: readBoolean(args.env, OBSERVER_ENV.showModel, pluginObserver, "showModel"),
    showProvider: readBoolean(args.env, OBSERVER_ENV.showProvider, pluginObserver, "showProvider"),
    showLatestText: readBoolean(
      args.env,
      OBSERVER_ENV.showLatestText,
      pluginObserver,
      "showLatestText",
    ),
    showReasoningSummary: readBoolean(
      args.env,
      OBSERVER_ENV.showReasoningSummary,
      pluginObserver,
      "showReasoningSummary",
    ),
  };

  validateObserverCapacity(config.maxVisibleSubagents, config.maxTrackedSubagents);
  return config;
}
