import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { resolveConnection, resolveSubagentConfig } from "./subagent-config.js";
import type { LayoutManagerController } from "./layout-manager.js";
import type { PaneBackend, PanePtyManager } from "./pane-backend.js";
import type { SubagentLogger } from "./subagent-logger.js";
import { consoleSubagentLogger } from "./subagent-logger.js";
import { TuiEventBusSource, SseEventSource } from "./subagent-event-source.js";
import { SubagentLifecycleManager } from "./subagent-lifecycle-manager.js";
import { SubagentPaneAdapter } from "./subagent-pane-adapter.js";
import type {
  AttachTarget,
  SubagentLikeSession,
  SubagentPaneManager,
  SubagentSessionClient,
} from "./subagent-types.js";

export interface SubagentIntegrationOptions {
  enabled?: boolean;
  maxPanes?: number;
}

export interface SubagentIntegrationHandle {
  enabled: boolean;
  stop(): Promise<void>;
  resyncNow(): Promise<void>;
  manager?: SubagentLifecycleManager;
}

export function createDefaultAttachTarget(session: SubagentLikeSession): AttachTarget {
  return { sessionId: session.id, createdAt: session.time.created };
}

export function createOpenTuiSubagentPaneManager(args: {
  layout: LayoutManagerController;
  ptyManager: PanePtyManager;
  paneBackend: PaneBackend;
  serverUrl: string;
  directory: string;
  username?: string;
  password?: string;
  logger: SubagentLogger;
}): SubagentPaneManager {
  return new SubagentPaneAdapter(args);
}

interface RuntimeApi {
  state?: { config?: unknown; path?: { directory?: string } };
  client?: {
    session?: { list: (options?: { signal?: AbortSignal }) => Promise<unknown> };
    event?: {
      subscribe: (options: { signal: AbortSignal }) => Promise<{ stream: AsyncIterable<unknown> }>;
    };
  };
  event?: { on: (type: string, handler: (event: unknown) => void) => () => void };
  keymap?: { registerLayer: (layer: unknown) => unknown };
  lifecycle?: { onDispose: (handler: () => unknown) => unknown; signal?: AbortSignal };
}

export async function attachSubagentIntegration(
  api: TuiPluginApi,
  options: SubagentIntegrationOptions,
  deps: {
    layout: LayoutManagerController;
    ptyManager: PanePtyManager;
    paneBackend: PaneBackend;
    logger?: SubagentLogger;
    env?: Record<string, string | undefined>;
  },
): Promise<SubagentIntegrationHandle> {
  const logger = deps.logger ?? consoleSubagentLogger;
  const runtime = api as unknown as RuntimeApi;
  const env = deps.env ?? process.env;
  const hostConfig = runtime.state?.config ?? {};
  const config = resolveSubagentConfig({ pluginOptions: options, hostConfig, env, logger });
  runtime.keymap?.registerLayer({
    commands: [
      {
        name: "sibyl.toggleSubagentDisplay",
        title: "Toggle Subagent Display",
        desc: "Subagent display is configured at startup",
        category: "Plugin",
        run: () => {
          if (config.enabled && config.maxPanes !== 0) {
            logger.info("[subagent] toggle is config-driven at startup");
          }
        },
      },
    ],
    bindings: [],
  });

  const noop: SubagentIntegrationHandle = {
    enabled: false,
    stop: async () => {},
    resyncNow: async () => {},
  };
  if (!config.enabled && config.maxPanes !== 0) return noop;

  const connection = resolveConnection({
    pluginOptions: {},
    pluginInput: { directory: runtime.state?.path?.directory },
    hostConfig,
    env,
    logger,
  });
  const paneManager = createOpenTuiSubagentPaneManager({
    layout: deps.layout,
    ptyManager: deps.ptyManager,
    paneBackend: deps.paneBackend,
    serverUrl: connection.serverUrl,
    directory: connection.directory,
    username: connection.username,
    password: connection.password,
    logger,
  });
  const sessionClient: SubagentSessionClient = {
    list: async (signal) => {
      const result = await runtime.client?.session?.list({ signal });
      const data = (result as { data?: unknown } | undefined)?.data;
      return Array.isArray(data) ? (data as SubagentLikeSession[]) : [];
    },
  };
  const useSse = env.SIBYL_SUBAGENT_SSE === "1" || env.SIBYL_SUBAGENT_SSE === "true";
  const eventSource = useSse
    ? new SseEventSource({
        subscribe: async (signal) => {
          const result = await runtime.client?.event?.subscribe({ signal });
          if (result === undefined) throw new Error("event subscription unavailable");
          return result;
        },
        listSessions: (signal) => sessionClient.list(signal),
        auth: { username: connection.username, password: connection.password },
        logger,
        lifecycleSignal: runtime.lifecycle?.signal,
        sleep: (ms, signal) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, ms);
            const abort = () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            };
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          }),
      })
    : new TuiEventBusSource({ eventBus: runtime.event ?? { on: () => () => {} }, logger });
  const manager = new SubagentLifecycleManager({
    paneManager,
    eventSource,
    sessionClient,
    config,
    logger,
  });
  await manager.start();
  runtime.lifecycle?.onDispose(() => manager.stop());
  return {
    enabled: config.enabled && config.maxPanes > 0,
    stop: () => manager.stop(),
    resyncNow: () => manager.resyncNow(),
    manager,
  };
}
