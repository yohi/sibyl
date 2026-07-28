import { describe, expect, test } from "bun:test"
import plugin from "../src/server"

describe("Server plugin", () => {
  test("exports default plugin object", () => {
    expect(plugin).toHaveProperty("id")
    expect(plugin).toHaveProperty("server")
    expect(typeof plugin.server).toBe("function")
  })
})
