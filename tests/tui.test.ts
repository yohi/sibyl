import { describe, expect, test } from "bun:test";
import plugin from "../src/tui";

function createDeferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve(value: T): void {
      if (!resolvePromise) throw new Error("Deferred promise is not initialized");
      resolvePromise(value);
    },
  };
}

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

  test("returns a dispose handler that awaits PTY termination", async () => {
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
    let settled = false;
    void Promise.resolve(result).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    termination.resolve();
    await result;
    expect(settled).toBe(true);
  });
});
