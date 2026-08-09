/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { LayoutManager, createLayoutManagerController } from "./layout-manager.js";
import { OpenTuiPaneBackend } from "./opentui-pane-backend.js";
import type { PaneBackend } from "./pane-backend.js";
import { PtyManager } from "./pty-manager.js";
import { DEFAULT_SHELL_COMMAND } from "./shell.js";
import type { PtyOptions } from "./types.js";

const defaultPtyOptions = {
  command: DEFAULT_SHELL_COMMAND,
  args: [],
} satisfies PtyOptions;

type TuiPtyManager = Pick<PtyManager, "spawn" | "terminate" | "terminateAll">;

type SubagentIntegrationFactory = (
  api: Parameters<TuiPlugin>[0],
  options: { enabled?: boolean; maxPanes?: number },
  deps: {
    layout: ReturnType<typeof createLayoutManagerController>;
    ptyManager: TuiPtyManager;
    paneBackend: PaneBackend;
  },
) => Promise<{ enabled: boolean; stop(): Promise<void>; resyncNow(): Promise<void> }>;

export function createTuiPlugin(
  ptyManager: TuiPtyManager = new PtyManager(undefined, () => import("node-pty")),
  paneBackend: PaneBackend = new OpenTuiPaneBackend(),
  subagentIntegrationFactory?: SubagentIntegrationFactory,
): TuiPlugin {
  return async (api, options) => {
    const initialRoot = {
      id: "root",
      children: [paneBackend.create(defaultPtyOptions)],
    };
    const layout = createLayoutManagerController(ptyManager, initialRoot, paneBackend);

    api.route.register([
      {
        name: "sibyl",
        render: ({ params }) => (
          <LayoutManager ptyManager={ptyManager} paneBackend={paneBackend} controller={layout} />
        ),
      },
    ]);
    api.keymap.registerLayer({
      commands: [
        {
          name: "sibyl.open",
          title: "Open Sibyl",
          desc: "Open the Sibyl multi-pane console",
          category: "Plugin",
          namespace: "palette",
          slashName: "sibyl",
          run: () => api.route.navigate("sibyl"),
        },
        {
          name: "sibyl.split.horizontal",
          title: "Split Pane Horizontally",
          desc: "Split the current pane horizontally",
          category: "Plugin",
          run: () => layout.splitPane("horizontal", defaultPtyOptions),
        },
        {
          name: "sibyl.split.vertical",
          title: "Split Pane Vertically",
          desc: "Split the current pane vertically",
          category: "Plugin",
          run: () => layout.splitPane("vertical", defaultPtyOptions),
        },
        {
          name: "sibyl.focus.next",
          title: "Focus Next Pane",
          desc: "Move focus to the next pane",
          category: "Plugin",
          run: () => layout.focusNext(),
        },
        {
          name: "sibyl.focus.prev",
          title: "Focus Previous Pane",
          desc: "Move focus to the previous pane",
          category: "Plugin",
          run: () => layout.focusPrev(),
        },
        {
          name: "sibyl.close",
          title: "Close Pane",
          desc: "Close the focused pane",
          category: "Plugin",
          run: () => layout.closePane(),
        },
      ],
      bindings: [
        { key: "ctrl+shift+s", cmd: "sibyl.open", desc: "Open Sibyl", preventDefault: true },
        {
          key: "ctrl+a h",
          cmd: "sibyl.split.horizontal",
          desc: "Split horizontally",
          preventDefault: true,
        },
        {
          key: "ctrl+a v",
          cmd: "sibyl.split.vertical",
          desc: "Split vertically",
          preventDefault: true,
        },
        { key: "ctrl+a n", cmd: "sibyl.focus.next", desc: "Focus next pane", preventDefault: true },
        {
          key: "ctrl+a p",
          cmd: "sibyl.focus.prev",
          desc: "Focus previous pane",
          preventDefault: true,
        },
        { key: "ctrl+a x", cmd: "sibyl.close", desc: "Close pane", preventDefault: true },
      ],
    });
    const runtimeApi = api as unknown as {
      state?: unknown;
      client?: unknown;
      event?: unknown;
    };
    if (subagentIntegrationFactory !== undefined || runtimeApi.state !== undefined) {
      const factory =
        subagentIntegrationFactory ??
        (await import("./subagent-integration.js")).attachSubagentIntegration;
      await factory(api, (options ?? {}) as { enabled?: boolean; maxPanes?: number }, {
        layout,
        ptyManager,
        paneBackend,
      });
    }
    api.lifecycle.onDispose(() => ptyManager.terminateAll());
  };
}

export const id = "oh-my-opencode.sibyl";

const tui = createTuiPlugin();

export default {
  id,
  tui,
} satisfies TuiPluginModule;
