import type { TuiPluginApi, TuiSlotContext } from "@opencode-ai/plugin/tui";
import { jsx } from "@opentui/solid/jsx-runtime";
import { SidebarObserver } from "./subagent-observer.js";
import type { ObserverConfig } from "./subagent-config.js";
import type { ObserverEventSource } from "./subagent-event-source.js";
import { TuiEventBusSource } from "./subagent-event-source.js";
import { consoleSubagentLogger } from "./subagent-logger.js";
import type { SubagentLogger } from "./subagent-logger.js";
import {
  createOpenCodeSnapshotReader,
  type ObserverSnapshotReader,
  type SnapshotSessionClient,
  type SnapshotSessionState,
} from "./subagent-snapshot-reader.js";
import { SubagentRegistry } from "./subagent-registry.js";

export interface ObserverIntegrationHandle {
  readonly enabled: boolean;
  readonly registry?: SubagentRegistry;
  stop(): Promise<void>;
  resyncNow(): Promise<void>;
}

export type ObserverIntegrationApi = Pick<
  TuiPluginApi,
  "client" | "event" | "state" | "slots" | "theme" | "lifecycle"
>;

export interface ObserverIntegrationDependencies {
  readonly logger?: SubagentLogger;
  readonly eventSource?: ObserverEventSource;
  readonly snapshotReader?: ObserverSnapshotReader;
}

function disabledHandle(): ObserverIntegrationHandle {
  return { enabled: false, stop: async () => {}, resyncNow: async () => {} };
}

function createSnapshotReader(
  api: ObserverIntegrationApi,
  logger: SubagentLogger,
): ObserverSnapshotReader {
  const sessionClient: SnapshotSessionClient = {
    children: (parameters, options) => api.client.session.children(parameters, options),
    status: (parameters, options) => api.client.session.status(parameters, options),
    messages: (parameters, options) => api.client.session.messages(parameters, options),
    message: (parameters, options) => api.client.session.message(parameters, options),
  };
  const sessionState: SnapshotSessionState = {
    get: (sessionID) => api.state.session.get(sessionID),
    messages: (sessionID) => api.state.session.messages(sessionID),
    status: (sessionID) => api.state.session.status(sessionID),
  };
  return createOpenCodeSnapshotReader({
    sessionClient,
    sessionState,
    readParts: (messageID) => api.state.part(messageID),
    logger,
  });
}

export async function attachSubagentIntegration(
  api: ObserverIntegrationApi,
  config: ObserverConfig,
  deps: ObserverIntegrationDependencies = {},
): Promise<ObserverIntegrationHandle> {
  if (!config.enabled) return disabledHandle();

  const logger = deps.logger ?? consoleSubagentLogger;
  const eventSource = deps.eventSource ?? new TuiEventBusSource({ eventBus: api.event, logger });
  const snapshotReader = deps.snapshotReader ?? createSnapshotReader(api, logger);
  const registry = new SubagentRegistry({ eventSource, snapshotReader, config, logger });
  let stopped = false;

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await registry.stop();
  };

  api.slots.register({
    slots: {
      sidebar_content: (
        context: Readonly<TuiSlotContext>,
        props: { readonly session_id: string },
      ) =>
        jsx(
          () =>
            SidebarObserver({
              registry,
              config,
              sessionId: props.session_id,
              theme: context.theme.current,
            }),
          {},
        ),
    },
  });
  api.lifecycle.onDispose(stop);

  return {
    enabled: true,
    registry,
    stop,
    resyncNow: () => registry.resyncNow(),
  };
}
