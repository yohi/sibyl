import { describe, expect, test } from "bun:test";
import { buildAttachPtyOptions } from "../src/subagent-attach-args";

describe("subagent attach arguments", () => {
  test("builds positional URL argv and sends credentials only through environment", () => {
    // Given / When
    const options = buildAttachPtyOptions({
      target: { sessionId: "ses-123", createdAt: 1 },
      serverUrl: "https://server.test",
      directory: "/repo",
      username: "alice",
      password: "secret",
    });

    // Then
    expect(options.args).toEqual([
      "attach",
      "https://server.test",
      "--session",
      "ses-123",
      "--dir",
      "/repo",
      "--mini",
    ]);
    expect(options.args.join(" ")).not.toContain("secret");
    expect(options.env).toEqual({
      OPENCODE_SERVER_USERNAME: "alice",
      OPENCODE_SERVER_PASSWORD: "secret",
    });
  });

  test.each([
    ["ftp://server.test", "ses-123"],
    ["https://alice:secret@server.test", "ses-123"],
    ["https://server.test", "ses;123"],
  ])("rejects invalid attach target %s / %s", (serverUrl, sessionId) => {
    // Given / When / Then
    expect(() =>
      buildAttachPtyOptions({
        target: { sessionId, createdAt: 1 },
        serverUrl,
        directory: "/repo",
      }),
    ).toThrow();
  });
});
