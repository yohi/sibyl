import { describe, expect, test } from "bun:test"
import { PtyManager } from "../src/pty-manager"

describe("PtyManager", () => {
  test("spawns a shell and receives data", async () => {
    const manager = new PtyManager()
    const shell = process.platform === "win32" ? "cmd.exe" : "bash"
    const pty = await manager.spawn({ command: shell, args: [], cols: 80, rows: 24 })

    const dataPromise = new Promise<string>((resolve) => {
      pty.onData((data) => {
        if (data.length > 0) resolve(data)
      })
    })

    pty.write("echo hello\r")
    const data = await dataPromise
    expect(data).toContain("hello")

    await manager.terminate(pty.id)
  })
})
