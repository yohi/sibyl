/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createLayoutManagerController, LayoutManager } from "./layout-manager.js"
import { PtyManager } from "./pty-manager.js"
import type { PaneModel, PtyOptions } from "./types.js"

const defaultPtyOptions = {
  command: process.platform === "win32" ? "cmd.exe" : process.env.SHELL || "sh",
  args: [],
} satisfies PtyOptions

const initialRoot = {
  id: "root",
  children: [
    {
      id: "pane-1",
      ptyOptions: defaultPtyOptions,
    },
  ],
} satisfies PaneModel

const tui: TuiPlugin = async (api) => {
  const ptyManager = new PtyManager(undefined, () => import("node-pty"))
  const layout = createLayoutManagerController(ptyManager, initialRoot)

  api.route.register([
    {
      name: "sibyl",
      render: () => <LayoutManager ptyManager={ptyManager} controller={layout} />,
    },
  ])
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
      { key: "ctrl+shift+s", cmd: "sibyl.open" },
      { key: "ctrl+a h", cmd: "sibyl.split.horizontal" },
      { key: "ctrl+a v", cmd: "sibyl.split.vertical" },
      { key: "ctrl+a n", cmd: "sibyl.focus.next" },
      { key: "ctrl+a p", cmd: "sibyl.focus.prev" },
      { key: "ctrl+a x", cmd: "sibyl.close" },
    ],
  })
  api.lifecycle.onDispose(() => ptyManager.terminateAll())
}

export default {
  id: "oh-my-opencode.sibyl",
  tui,
} satisfies TuiPluginModule
