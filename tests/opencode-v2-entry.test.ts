import { expect, test } from "bun:test";
import { attachV2Sidebar, createV2Plugin, disposeV2PluginResources } from "../src/tui-v2";
import { DEFAULT_OBSERVER_CONFIG } from "../src/subagent-config";

test("V2 entry supplies observer options and returns cleanup", async () => {
  let enabled = false;
  let cleaned = false;
  const plugin = createV2Plugin({
    env: {},
    attach: async (_context, config) => {
      enabled = config.enabled;
      return async () => {
        cleaned = true;
      };
    },
  });
  const cleanup = await Reflect.apply(plugin.setup, undefined, [
    { options: { observer: { enabled: true } } },
  ]);
  expect(plugin.id).toBe("oh-my-opencode.sibyl");
  expect(enabled).toBe(true);
  await cleanup();
  expect(cleaned).toBe(true);
});

test("V2 setup appends a sidebar slot and releases it on cleanup", async () => {
  let claim: unknown;
  let disposed = false;
  const context = {
    ui: {
      slot(value: unknown) {
        claim = value;
        return () => {
          disposed = true;
        };
      },
    },
  };
  const cleanup = await Reflect.apply(attachV2Sidebar, undefined, [
    context,
    DEFAULT_OBSERVER_CONFIG,
  ]);
  expect(claim).toMatchObject({ append: "sidebar.content" });
  await cleanup();
  expect(disposed).toBe(true);
});

test("plugin cleanup still awaits mounted resources if slot disposal fails", async () => {
  let cleaned = false;
  await expect(
    disposeV2PluginResources(() => {
      throw new Error("slot dispose");
    }, [
      async () => {
        cleaned = true;
      },
    ]),
  ).rejects.toThrow("slot dispose");
  expect(cleaned).toBe(true);
});
