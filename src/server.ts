import type { Plugin, PluginModule } from "@opencode-ai/plugin"

const server: Plugin = async () => ({
  config: async (config) => {
    config.command ??= {}
    config.command.sibyl = {
      template: "Open the Sibyl console.",
    }
  },
  "command.execute.before": async () => {},
})

export default {
  id: "oh-my-opencode.sibyl",
  server,
} satisfies PluginModule
