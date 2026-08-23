import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { resolveObserverConfig } from "./subagent-config.js";
import {
  attachSubagentIntegration,
  type ObserverIntegrationApi,
  type ObserverIntegrationDependencies,
  type ObserverIntegrationHandle,
} from "./subagent-integration.js";
import { consoleSubagentLogger, type SubagentLogger } from "./subagent-logger.js";

export interface TuiPluginDependencies {
  readonly logger?: SubagentLogger;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly attach?: typeof attachSubagentIntegration;
}

export function createTuiPlugin(deps: TuiPluginDependencies = {}): TuiPlugin {
  return async (api, options) => {
    const logger = deps.logger ?? consoleSubagentLogger;
    const resolution = resolveObserverConfig({
      pluginOptions: options,
      hostConfig: api.state.config,
      env: deps.env ?? process.env,
    });
    if (resolution.legacySettingsDetected) {
      logger.warn(
        "[subagent] legacy PTY display, connection, and attach settings are deprecated and ignored by Sibyl v2 Observer",
      );
    }

    const attach = deps.attach ?? attachSubagentIntegration;
    await attach(api, resolution.config, { logger });
  };
}

export { attachSubagentIntegration };
export type { ObserverIntegrationApi, ObserverIntegrationDependencies, ObserverIntegrationHandle };

export const id = "oh-my-opencode.sibyl";

const tui = createTuiPlugin();

export default {
  id,
  tui,
} satisfies TuiPluginModule;
