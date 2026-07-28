import { describe, expect, test } from "bun:test"
import plugin from "../src/tui"

describe("TUI plugin", () => {
  test("exports default plugin object", () => {
    expect(plugin).toHaveProperty("id")
    expect(plugin).toHaveProperty("tui")
    expect(typeof plugin.tui).toBe("function")
  })
})
