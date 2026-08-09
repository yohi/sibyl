import { describe, expect, test } from "bun:test";
import { resolveConnection, resolveSubagentConfig } from "../src/subagent-config";
import type { SubagentLogger } from "../src/subagent-logger";

class RecordingLogger implements SubagentLogger {
  readonly errors: string[] = [];

  info(_message: string): void {}

  warn(_message: string): void {}

  error(message: string): void {
    this.errors.push(message);
  }
}

const hostConfig = {
  akane: {
    experimental: {
      watchdog: {
        subagentDisplay: {
          enabled: false,
          maxPanes: 3,
          serverUrl: "https://akane.test",
          directory: "/akane",
        },
      },
    },
  },
  sibyl: {
    subagentDisplay: {
      enabled: true,
      maxPanes: 7,
      serverUrl: "https://sibyl.test",
      directory: "/sibyl",
    },
  },
};

describe("subagent configuration", () => {
  test("resolves each setting with env over plugin options over akane over sibyl", () => {
    // Given
    const logger = new RecordingLogger();
    const pluginOptions = {
      enabled: true,
      maxPanes: 5,
      serverUrl: "https://plugin.test",
      directory: "/plugin",
    };

    // When
    const config = resolveSubagentConfig({
      pluginOptions,
      hostConfig,
      env: { SIBYL_SUBAGENT_ENABLED: "false" },
      logger,
    });
    const connection = resolveConnection({
      pluginOptions,
      hostConfig,
      env: { OPENCODE_SERVER_URL: "https://env.test" },
      logger,
    });

    // Then
    expect(config).toEqual({ enabled: false, maxPanes: 5 });
    expect(connection).toMatchObject({
      serverUrl: "https://env.test",
      directory: "/plugin",
    });
  });

  test("uses akane and sibyl independently when higher sources omit different fields", () => {
    // Given
    const logger = new RecordingLogger();

    // When
    const connection = resolveConnection({
      pluginOptions: {},
      hostConfig: {
        akane: {
          experimental: {
            watchdog: { subagentDisplay: { serverUrl: "https://akane.test" } },
          },
        },
        sibyl: { subagentDisplay: { directory: "/sibyl" } },
      },
      env: {},
      logger,
    });

    // Then
    expect(connection).toMatchObject({ serverUrl: "https://akane.test", directory: "/sibyl" });
  });

  test.each(["maybe", "", "2"])("rejects invalid defined boolean value %s", (enabled) => {
    // Given / When / Then
    expect(() =>
      resolveSubagentConfig({
        pluginOptions: {},
        hostConfig,
        env: { SIBYL_SUBAGENT_ENABLED: enabled },
        logger: new RecordingLogger(),
      }),
    ).toThrow();
  });

  test("rejects selected invalid maxPanes rather than falling back", () => {
    // Given / When / Then
    expect(() =>
      resolveSubagentConfig({
        pluginOptions: { maxPanes: 2.5 },
        hostConfig,
        env: {},
        logger: new RecordingLogger(),
      }),
    ).toThrow();
  });

  test.each(["", " "])("rejects empty maxPanes value %j", (maxPanes) => {
    // Given / When / Then
    expect(() =>
      resolveSubagentConfig({
        pluginOptions: { maxPanes },
        hostConfig,
        env: {},
        logger: new RecordingLogger(),
      }),
    ).toThrow();
  });

  test("rejects selected invalid server URL rather than falling back", () => {
    // Given / When / Then
    expect(() =>
      resolveConnection({
        pluginOptions: { serverUrl: "ftp://plugin.test", directory: "/plugin" },
        hostConfig,
        env: {},
        logger: new RecordingLogger(),
      }),
    ).toThrow();
  });
});
