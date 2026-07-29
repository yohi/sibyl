import { describe, expect, test } from "bun:test"
import { closePane, findPane, nextLeaf, prevLeaf, splitPane } from "../src/keymap"
import type { PaneModel } from "../src/types"

describe("keymap helpers", () => {
  test("splits a leaf pane horizontally while preserving its id", () => {
    const tree = { id: "root", ptyOptions: { command: "bash", args: [] } }

    const next = splitPane(tree, "root", "horizontal", { command: "bash", args: [] })

    expect(next.children).toHaveLength(2)
    expect(next.direction).toBe("horizontal")
    expect(next.id).not.toBe("root")
    expect(next.children?.[0]?.id).toBe("root")
  })

  test("terminates a leaf before removing it and focuses a remaining pane", async () => {
    const tree = {
      id: "split-1",
      direction: "horizontal" as const,
      children: [
        { id: "left", ptyOptions: { command: "bash", args: [] } },
        { id: "right", ptyOptions: { command: "bash", args: [] } },
      ],
    }
    const terminated: string[] = []

    const result = await closePane(tree, "left", async (leaf) => {
      terminated.push(leaf.id)
    })

    expect(terminated).toEqual(["left"])
    expect(result.root?.id).toBe("right")
    expect(result.focusedId).toBe("right")
  })

  test("finds panes and cycles focus through leaves", () => {
    const tree = {
      id: "split-1",
      direction: "horizontal",
      children: [
        { id: "left", ptyOptions: { command: "bash", args: [] } },
        {
          id: "split-2",
          direction: "vertical",
          children: [
            { id: "middle", ptyOptions: { command: "bash", args: [] } },
            { id: "right", ptyOptions: { command: "bash", args: [] } },
          ],
        },
      ],
    } satisfies PaneModel

    expect(findPane(tree, "middle")?.id).toBe("middle")
    expect(findPane(tree, "missing")).toBeUndefined()
    expect(nextLeaf(tree, "middle")).toBe("right")
    expect(nextLeaf(tree, "right")).toBe("left")
    expect(prevLeaf(tree, "middle")).toBe("left")
    expect(prevLeaf(tree, "left")).toBe("right")
  })
})
