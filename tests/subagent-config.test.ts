import { describe, expect, test } from "bun:test";
import { DEFAULT_OBSERVER_CONFIG, resolveObserverConfig } from "../src/subagent-config";

describe("observer configuration", () => {
  test("resolves each field independently as env over plugin over default", () => {
    const result = resolveObserverConfig({
      pluginOptions: { observer: { maxVisibleSubagents: 4, activityLimit: 3 } },
      env: {
        SIBYL_OBSERVER_MAX_TRACKED_SUBAGENTS: "96",
        SIBYL_OBSERVER_SHOW_PROVIDER: "true",
      },
    });

    expect(result).toEqual({
      enabled: false,
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

  test("discards legacy values without retaining sensitive settings", () => {
    const result = resolveObserverConfig({
      pluginOptions: {
        enabled: true,
        maxPanes: 1,
        serverUrl: "https://legacy.test",
        directory: "/legacy",
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

    expect(result).toEqual(DEFAULT_OBSERVER_CONFIG);
    expect(JSON.stringify(result)).not.toContain("must-not-flow");
  });

  test("does not fall through when the selected value is invalid", () => {
    expect(() =>
      resolveObserverConfig({
        pluginOptions: { observer: { activityLimit: 5 } },
        env: { SIBYL_OBSERVER_ACTIVITY_LIMIT: "0" },
      }),
    ).toThrow("Invalid observer activityLimit");
  });

  test("rejects a non-object observer option without reading legacy fields as observer values", () => {
    expect(() =>
      resolveObserverConfig({
        pluginOptions: { observer: "true", enabled: true },
        env: {},
      }),
    ).toThrow("Invalid observer configuration");
  });
});
