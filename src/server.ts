import type { Plugin, PluginModule } from "@opencode-ai/plugin";

const server: Plugin = async () => ({
  config: async (config) => {
    config.command ??= {};
    config.command.sibyl = {
      description: "Open Sibyl",
      template: "Open the Sibyl console.",
    };
    config.command["sibyl.toggleSubagentDisplay"] = {
      description: "Toggle Sibyl subagent display",
      template: "Toggle the Sibyl subagent display (configured at startup).",
    };
  },
  "command.execute.before": async (input) => {
    if (input.command !== "sibyl") return;
    // Intentionally no-op: the TUI plugin registers `sibyl.open` and the
    // host navigates to the Sibyl route. This hook only prevents other
    // plugins from treating `/sibyl` as an unknown command.
  },
});

export default {
  id: "oh-my-opencode.sibyl",
  server,
} satisfies PluginModule;
