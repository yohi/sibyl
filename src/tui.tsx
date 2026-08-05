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

export function createTuiPlugin(
  ptyManager: TuiPtyManager = new PtyManager(undefined, () => import("node-pty")),
  paneBackend: PaneBackend = new OpenTuiPaneBackend(),
): TuiPlugin {
  return async (api) => {
    const initialRoot = {
      id: "root",
      children: [paneBackend.create(defaultPtyOptions)],
    };
    const layout = createLayoutManagerController(ptyManager, initialRoot, paneBackend);

    api.route.register([
      {
        name: "sibyl",
        render: () => (
          <LayoutManager ptyManager={ptyManager} paneBackend={paneBackend} controller={layout} />
        ),
      },
    ]);
    api.keymap.registerLayer({
      commands: [
        {
          name: "sibyl.open",
          title: "Open Sibyl",
          category: "Plugin",
          namespace: "palette",
          slashName: "sibyl",
          run: () => api.route.navigate("sibyl"),
        },
        {
          name: "sibyl.split.horizontal",
          title: "Split Pane Horizontally",
          category: "Plugin",
          run: () => layout.splitPane("horizontal", defaultPtyOptions),
        },
        {
          name: "sibyl.split.vertical",
          title: "Split Pane Vertically",
          category: "Plugin",
          run: () => layout.splitPane("vertical", defaultPtyOptions),
        },
        {
          name: "sibyl.focus.next",
          title: "Focus Next Pane",
          category: "Plugin",
          run: () => layout.focusNext(),
        },
        {
          name: "sibyl.focus.prev",
          title: "Focus Previous Pane",
          category: "Plugin",
          run: () => layout.focusPrev(),
        },
        {
          name: "sibyl.close",
          title: "Close Pane",
          category: "Plugin",
          run: () => layout.closePane(),
        },
      ],
      bindings: [
        { key: "ctrl+shift+s", cmd: "sibyl.open", preventDefault: true },
        { key: "ctrl+a h", cmd: "sibyl.split.horizontal", preventDefault: true },
        { key: "ctrl+a v", cmd: "sibyl.split.vertical", preventDefault: true },
        { key: "ctrl+a n", cmd: "sibyl.focus.next", preventDefault: true },
        { key: "ctrl+a p", cmd: "sibyl.focus.prev", preventDefault: true },
        { key: "ctrl+a x", cmd: "sibyl.close", preventDefault: true },
      ],
    });
    api.lifecycle.onDispose(() => ptyManager.terminateAll());
  };
}

const tui = createTuiPlugin();

export default {
  id: "oh-my-opencode.sibyl",
  tui,
} satisfies TuiPluginModule;
