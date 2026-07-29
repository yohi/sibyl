import type { Plugin, PluginModule } from "@opencode-ai/plugin";

const server: Plugin = async () => ({
  config: async (config) => {
    config.command ??= {};
    config.command.sibyl = {
      description: "Open Sibyl",
      template: "Open the Sibyl console.",
    };
  },
  "command.execute.before": async (input) => {
    if (input.command !== "sibyl") return;
    // Navigation is handled by the host.
  },
});

export default {
  id: "oh-my-opencode.sibyl",
  server,
} satisfies PluginModule;
