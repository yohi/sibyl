import { describe, expect, test } from "bun:test"
import { OpenTuiPaneBackend } from "../src/opentui-pane-backend"

describe("OpenTuiPaneBackend", () => {
  test("returns a pane model with PTY options", () => {
    const backend = new OpenTuiPaneBackend()
    const pane = backend.create({
      command: "bash",
      args: [],
      cols: 80,
      rows: 24,
    })

    expect(pane.ptyOptions).toEqual({
      command: "bash",
      args: [],
      cols: 80,
      rows: 24,
    })
  })
})
