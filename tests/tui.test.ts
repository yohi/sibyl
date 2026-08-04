import { describe, expect, test } from "bun:test";
import plugin from "../src/tui";

import { createDeferred } from "./helpers/deferred";

describe("TUI plugin", () => {
  test("exports default plugin object", () => {
    expect(plugin).toHaveProperty("id");
    expect(plugin).toHaveProperty("tui");
    expect(typeof plugin.tui).toBe("function");
  });

  test("registers the Sibyl route, keymap layer, and dispose handler", async () => {
    const routes: Array<{ name: string }> = [];
    const layers: Array<{
      commands?: Array<Record<string, unknown>>;
      bindings?: Array<Record<string, unknown>>;
    }> = [];
    const disposeHandlers: Array<() => void> = [];

    const api = {
      route: {
        register: (registeredRoutes: Array<{ name: string }>) => {
          routes.push(...registeredRoutes);
          return () => {};
        },
      },
      keymap: {
        registerLayer: (layer: {
          commands?: Array<Record<string, unknown>>;
          bindings?: Array<Record<string, unknown>>;
        }) => {
          layers.push(layer);
          return () => {};
        },
      },
      lifecycle: {
        onDispose: (handler: () => void) => {
          disposeHandlers.push(handler);
          return () => {};
        },
      },
    };

    await Reflect.apply(plugin.tui, undefined, [api, undefined, undefined]);

    expect(routes.map((route) => route.name)).toContain("sibyl");
    expect(layers).toHaveLength(1);
    expect(layers[0]?.commands?.map((command) => command.name)).toEqual(
      expect.arrayContaining([
        "sibyl.open",
        "sibyl.split.horizontal",
        "sibyl.split.vertical",
        "sibyl.focus.next",
        "sibyl.focus.prev",
        "sibyl.close",
      ]),
    );
    expect(disposeHandlers).toHaveLength(1);
  });

  test("marks pane operation bindings as consumed before PTY input handlers run", async () => {
    // Given
    const layers: Array<{
      bindings?: Array<{ readonly cmd?: string; readonly preventDefault?: boolean }>;
    }> = [];
    const api = {
      route: { register: () => () => {}, navigate: () => {} },
      keymap: {
        registerLayer: (layer: {
          bindings?: Array<{ readonly cmd?: string; readonly preventDefault?: boolean }>;
        }) => {
          layers.push(layer);
          return () => {};
        },
      },
      lifecycle: { onDispose: () => () => {} },
    };

    // When
    await Reflect.apply(plugin.tui, undefined, [api, undefined, undefined]);

    // Then
    const operationCommands = new Set([
      "sibyl.split.horizontal",
      "sibyl.split.vertical",
      "sibyl.focus.next",
      "sibyl.focus.prev",
      "sibyl.close",
    ]);
    const operationBindings = layers[0]?.bindings?.filter((binding) =>
      operationCommands.has(binding.cmd ?? ""),
    );
    expect(operationBindings).toBeArray();
    expect(operationBindings?.length).toBe(operationCommands.size);
    expect(operationBindings?.every((binding) => binding.preventDefault === true)).toBe(true);
  });

  test("returns a dispose promise that settles after PTY termination", async () => {
    // Given
    const tuiModule = await import("../src/tui");
    const factory = Reflect.get(tuiModule, "createTuiPlugin");
    expect(factory).toBeFunction();
    if (typeof factory !== "function") throw new Error("TUI plugin factory is missing");

    const termination = createDeferred<void>();
    const disposeHandlers: Array<() => void | Promise<void>> = [];
    const api = {
      route: { register: () => () => {} },
      keymap: { registerLayer: () => () => {} },
      lifecycle: {
        onDispose: (handler: () => void | Promise<void>) => {
          disposeHandlers.push(handler);
          return () => {};
        },
      },
    };
    const ptyManager = {
      spawn: async () => {
        throw new Error("Spawn is not used during plugin registration");
      },
      terminate: async () => {},
      terminateAll: () => termination.promise,
    };
    const tui = factory(ptyManager);
    await Reflect.apply(tui, undefined, [api, undefined, undefined]);
    const dispose = disposeHandlers[0];
    if (!dispose) throw new Error("Dispose handler is missing");

    // When
    const result = dispose();

    // Then
    expect(result).toBeInstanceOf(Promise);
    if (result === undefined) throw new Error("Dispose did not return a promise");
    let settled = false;
    result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    termination.resolve();
    await result;
    expect(settled).toBe(true);
  });

  test("rejects the dispose promise when PTY termination fails", async () => {
    // Given
    const disposeHandlers: Array<() => void | Promise<void>> = [];
    const api = {
      route: { register: () => () => {} },
      keymap: { registerLayer: () => () => {} },
      lifecycle: {
        onDispose: (handler: () => void | Promise<void>) => {
          disposeHandlers.push(handler);
          return () => {};
        },
      },
    };
    const ptyManager = {
      spawn: async () => {
        throw new Error("Spawn is not used during plugin registration");
      },
      terminate: async () => {},
      terminateAll: async () => {
        throw new Error("termination failed");
      },
    };
    const tuiModule = await import("../src/tui");
    const tui = tuiModule.createTuiPlugin(ptyManager);
    await Reflect.apply(tui, undefined, [api, undefined, undefined]);
    const dispose = disposeHandlers[0];
    if (!dispose) throw new Error("Dispose handler is missing");

    // When
    const result = dispose();

    // Then
    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toThrow("termination failed");
  });
});
