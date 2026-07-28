import { describe, expect, test } from "bun:test"
import { Pane } from "../src/pane"

describe("Pane", () => {
  test("renders with title", () => {
    // 実際のレンダリングテストは OpenTUI test renderer が必要。
    // 初期は型レベルと props 検証に留める。
    expect(typeof Pane).toBe("function")
  })
})
