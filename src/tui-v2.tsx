import { Plugin } from "@opencode/plugin/tui";
import { jsx } from "@opentui/solid/jsx-runtime";
import { resolveObserverConfig, type ObserverConfig } from "./subagent-config.js";
import { SidebarV2 } from "./sidebar-v2.js";

export async function disposeV2PluginResources(
  disposeSlot: () => void,
  cleanups: readonly (() => Promise<void>)[],
): Promise<void> {
  let slotError: unknown;
  try {
    disposeSlot();
  } catch (error) {
    slotError = error;
  }
  await Promise.allSettled(cleanups.map((cleanup) => cleanup()));
  if (slotError !== undefined) throw slotError;
}

export async function attachV2Sidebar(
  context: Plugin.Context,
  config: ObserverConfig,
): Promise<() => Promise<void>> {
  const cleanups = new Set<() => Promise<void>>();
  const dispose = context.ui.slot({
    append: "sidebar.content",
    render: (input) =>
      jsx(
        () =>
          SidebarV2({
            context,
            config,
            get sessionId() {
              return input.sessionID;
            },
            registerCleanup: (cleanup: () => Promise<void>) => {
              cleanups.add(cleanup);
              return () => {
                cleanups.delete(cleanup);
              };
            },
          }),
        {},
      ),
  });
  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    await disposeV2PluginResources(dispose, [...cleanups]);
    cleanups.clear();
  };
}

export function createV2Plugin(deps: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly attach: (
    context: Plugin.Context,
    config: ObserverConfig,
  ) => Promise<() => Promise<void>>;
}): Plugin.Definition {
  return {
    id: "oh-my-opencode.sibyl",
    async setup(context) {
      const config = resolveObserverConfig({ pluginOptions: context.options, env: deps.env });
      return deps.attach(context, config);
    },
  };
}

export default Plugin.define(createV2Plugin({ env: process.env, attach: attachV2Sidebar }));
