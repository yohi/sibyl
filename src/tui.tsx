/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { LayoutManager } from "./layout-manager.js"
import { PtyManager } from "./pty-manager.js"
import type { PaneModel } from "./types.js"

const initialRoot = {
  id: "root",
  children: [
    {
      id: "pane-1",
      ptyOptions: {
        command: process.platform === "win32" ? "cmd.exe" : process.env.SHELL || "sh",
        args: [],
      },
    },
  ],
} satisfies PaneModel

const tui: TuiPlugin = async (api) => {
  const ptyManager = new PtyManager(undefined, () => import("node-pty"))

  api.route.register([
    {
      name: "sibyl",
      render: () => <LayoutManager ptyManager={ptyManager} model={initialRoot} />,
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
    ],
    bindings: [{ key: "ctrl+shift+s", cmd: "sibyl.open" }],
  })
  api.lifecycle.onDispose(() => ptyManager.terminateAll())
}

export default {
  id: "oh-my-opencode.sibyl",
  tui,
} satisfies TuiPluginModule
