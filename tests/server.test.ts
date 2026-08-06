import { describe, expect, test } from "bun:test";
import plugin from "../src/server";

describe("Server plugin", () => {
  test("exports default plugin object", () => {
    expect(plugin).toHaveProperty("id");
    expect(plugin).toHaveProperty("server");
    expect(typeof plugin.server).toBe("function");
  });

  test("registers the Sibyl command and ignores other commands", async () => {
    const hooks = await Reflect.apply(plugin.server, undefined, [undefined]);
    const config: { command?: Record<string, Record<string, string>> } = {};

    await hooks.config?.(config);

    expect(config.command?.sibyl).toEqual({
      description: "Open Sibyl",
      template: "Open the Sibyl console.",
    });
    expect(hooks["command.execute.before"]).toBeFunction();

    const output = { parts: [] };
    await hooks["command.execute.before"]?.(
      { command: "other", sessionID: "session", arguments: "" },
      output,
    );
    expect(output).toEqual({ parts: [] });
  });

  test("delegates sibyl command handling to the host without mutating output", async () => {
    const hooks = await Reflect.apply(plugin.server, undefined, [undefined]);
    const output = { parts: [] };

    await hooks["command.execute.before"]?.(
      { command: "sibyl", sessionID: "session", arguments: "" },
      output,
    );

    expect(output).toEqual({ parts: [] });
  });
});
