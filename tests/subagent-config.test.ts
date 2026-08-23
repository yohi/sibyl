import { describe, expect, test } from "bun:test";
import { DEFAULT_OBSERVER_CONFIG, resolveObserverConfig } from "../src/subagent-config";

describe("observer configuration", () => {
  test("resolves every field independently as env over plugin over sibyl.observer over default", () => {
    const result = resolveObserverConfig({
      pluginOptions: { observer: { maxVisibleSubagents: 4, activityLimit: 3 } },
      hostConfig: {
        sibyl: {
          observer: {
            enabled: true,
            maxVisibleSubagents: 2,
            maxTrackedSubagents: 32,
            showProvider: false,
          },
        },
      },
      env: {
        SIBYL_OBSERVER_MAX_TRACKED_SUBAGENTS: "96",
        SIBYL_OBSERVER_SHOW_PROVIDER: "true",
      },
    });

    expect(result.config).toEqual({
      enabled: true,
      maxVisibleSubagents: 4,
      maxTrackedSubagents: 96,
      activityLimit: 3,
      idleRetentionMs: 300_000,
      showModel: true,
      showProvider: true,
      showLatestText: true,
      showReasoningSummary: true,
    });
  });

  test("detects and discards every legacy source", () => {
    const result = resolveObserverConfig({
      pluginOptions: {
        enabled: true,
        maxPanes: 1,
        serverUrl: "https://legacy.test",
        directory: "/legacy",
      },
      hostConfig: {
        sibyl: { subagentDisplay: { enabled: true, maxPanes: 1 } },
        akane: { experimental: { watchdog: { subagentDisplay: { enabled: true } } } },
      },
      env: {
        SIBYL_SUBAGENT_ENABLED: "true",
        SIBYL_SUBAGENT_MAX_PANES: "1",
        OPENCODE_SERVER_URL: "https://legacy.test",
        OPENCODE_PROJECT_DIR: "/legacy",
        OPENCODE_SERVER_USERNAME: "legacy-user",
        OPENCODE_SERVER_PASSWORD: "must-not-flow",
      },
    });

    expect(result.legacySettingsDetected).toBe(true);
    expect(result.config).toEqual(DEFAULT_OBSERVER_CONFIG);
    expect(JSON.stringify(result)).not.toContain("must-not-flow");
  });

  test("does not fall through when the selected value is invalid", () => {
    expect(() =>
      resolveObserverConfig({
        pluginOptions: { observer: { activityLimit: 5 } },
        hostConfig: { sibyl: { observer: { activityLimit: 4 } } },
        env: { SIBYL_OBSERVER_ACTIVITY_LIMIT: "0" },
      }),
    ).toThrow("Invalid observer activityLimit");
  });

  test("rejects a non-object observer option without reading legacy fields as observer values", () => {
    expect(() =>
      resolveObserverConfig({
        pluginOptions: { observer: "true", enabled: true },
        hostConfig: {},
        env: {},
      }),
    ).toThrow("Invalid observer configuration");
  });
});
