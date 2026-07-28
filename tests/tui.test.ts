import { describe, expect, test } from "bun:test"
import plugin from "../src/tui"

describe("TUI plugin", () => {
  test("exports default plugin object", () => {
    expect(plugin).toHaveProperty("id")
    expect(plugin).toHaveProperty("tui")
    expect(typeof plugin.tui).toBe("function")
  })

  test("registers the Sibyl route, keymap layer, and dispose handler", async () => {
    const routes: Array<{ name: string }> = []
    const layers: Array<{
      commands?: Array<Record<string, unknown>>
      bindings?: Array<Record<string, unknown>>
    }> = []
    const disposeHandlers: Array<() => void> = []

    const api = {
      route: {
        register: (registeredRoutes: Array<{ name: string }>) => {
          routes.push(...registeredRoutes)
          return () => {}
        },
      },
      keymap: {
        registerLayer: (layer: {
          commands?: Array<Record<string, unknown>>
          bindings?: Array<Record<string, unknown>>
        }) => {
          layers.push(layer)
          return () => {}
        },
      },
      lifecycle: {
        onDispose: (handler: () => void) => {
          disposeHandlers.push(handler)
          return () => {}
        },
      },
    }

    await Reflect.apply(plugin.tui, undefined, [api, undefined, undefined])

    expect(routes.map((route) => route.name)).toContain("sibyl")
    expect(layers).toHaveLength(1)
    expect(layers[0]?.commands?.map((command) => command.name)).toContain("sibyl.open")
    expect(disposeHandlers).toHaveLength(1)
  })
})
