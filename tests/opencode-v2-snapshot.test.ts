import { expect, test } from "bun:test";
import { DEFAULT_OBSERVER_CONFIG } from "../src/subagent-config";
import { limitParts } from "../src/subagent-snapshot-reader";
import { createV2SnapshotReader, readSessionLocation } from "../src/subagent-v2-snapshot";
import { makeAssistant, makeSession } from "./helpers/opencode-v2";

test("selects busy direct children across paginated session results", async () => {
  const idle = Array.from({ length: 8 }, (_, index) => makeSession({ id: `ses_idle${index}` }));
  const reader = createV2SnapshotReader({
    list: async ({ cursor }) =>
      cursor
        ? { data: [makeSession({ id: "ses_busy" })], cursor: {} }
        : { data: idle, cursor: { next: "page2" } },
    active: async () => ({ ses_busy: { type: "running" } }),
    messages: async () => ({ data: [makeAssistant()], cursor: {} }),
    message: async () => makeAssistant(),
  });
  const snapshot = await reader.readParent(
    "ses_parent",
    { ...DEFAULT_OBSERVER_CONFIG, maxTrackedSubagents: 8 },
    new AbortController().signal,
  );
  expect(snapshot.children).toHaveLength(8);
  expect(snapshot.children[0]?.session.id).toBe("ses_busy");
  expect(snapshot.omittedCount).toBe(1);
});

test("resolves the selected session location instead of the host default", async () => {
  const session = makeSession({ location: { directory: "/project/child" } });
  let requested = "";
  const result = await readSessionLocation(
    {
      session: { get: async () => session },
      location: {
        get: async (input) => {
          requested = input?.location?.directory ?? "";
          return {
            directory: requested,
            project: { id: "project_test", directory: "/project", canonical: "/project" },
          };
        },
      },
    },
    "ses_child",
    new AbortController().signal,
  );
  expect(requested).toBe("/project/child");
  expect(result?.directory).toBe("/project/child");
});

test("does not resolve location when the returned session does not match", async () => {
  let calls = 0;
  const result = await readSessionLocation(
    {
      session: { get: async () => makeSession({ id: "ses_other" }) },
      location: {
        get: async () => {
          calls += 1;
          return {
            directory: "/other",
            project: { id: "project_test", directory: "/other", canonical: "/other" },
          };
        },
      },
    },
    "ses_child",
    new AbortController().signal,
  );
  expect(result).toBeUndefined();
  expect(calls).toBe(0);
});

test("rejects a location response for a different directory", async () => {
  const result = await readSessionLocation(
    {
      session: { get: async () => makeSession({ location: { directory: "/project/child" } }) },
      location: {
        get: async () => ({
          directory: "/project/other",
          project: { id: "project_test", directory: "/project", canonical: "/project" },
        }),
      },
    },
    "ses_child",
    new AbortController().signal,
  );
  expect(result).toBeUndefined();
});

test("rejects cyclic session pagination", async () => {
  let calls = 0;
  const reader = createV2SnapshotReader({
    list: async ({ cursor }) => {
      calls += 1;
      if (calls > 4) return { data: [], cursor: {} };
      return { data: [], cursor: { next: cursor === "a" ? "b" : "a" } };
    },
    active: async () => ({}),
    messages: async () => ({ data: [] }),
    message: async () => makeAssistant(),
  });
  await expect(
    reader.readParent("ses_parent", DEFAULT_OBSERVER_CONFIG, new AbortController().signal),
  ).rejects.toThrow();
});

test("discards content returned for a different message ID", async () => {
  const reader = createV2SnapshotReader({
    list: async () => ({ data: [], cursor: {} }),
    active: async () => ({}),
    messages: async () => ({ data: [] }),
    message: async () =>
      makeAssistant({
        id: "msg_wrong",
        content: [{ type: "text", text: "wrong session content" }],
      }),
  });
  expect(
    await reader.readMessage("ses_child", "msg_expected", new AbortController().signal),
  ).toEqual({ parts: [] });
});

test("retains current tool when content exceeds the part limit", async () => {
  const finished = Array.from({ length: 64 }, (_, index) => ({
    type: "tool" as const,
    id: `tool_${index}`,
    name: "read",
    time: { created: index, completed: index },
    state: {
      status: "completed" as const,
      input: {},
      content: [{ type: "text" as const, text: "done" }] as [{ type: "text"; text: string }],
    },
  }));
  const running = {
    type: "tool" as const,
    id: "tool_running",
    name: "search",
    time: { created: 99, ran: 99 },
    state: { status: "running" as const, input: {}, metadata: {} },
  };
  const reader = createV2SnapshotReader({
    list: async () => ({ data: [makeSession()], cursor: {} }),
    active: async () => ({}),
    messages: async () => ({ data: [makeAssistant({ content: [...finished, running] })] }),
    message: async () => makeAssistant(),
  });
  const snapshot = await reader.readParent(
    "ses_parent",
    DEFAULT_OBSERVER_CONFIG,
    new AbortController().signal,
  );
  expect(snapshot.children[0]?.parts).toHaveLength(64);
  expect(snapshot.children[0]?.parts).toEqual(
    expect.arrayContaining([expect.objectContaining({ partId: "tool_running" })]),
  );
});

test("uses a current assistant retry marker in the snapshot status", async () => {
  const reader = createV2SnapshotReader({
    list: async () => ({
      data: [makeSession({ outcome: "succeeded", time: { created: 1, updated: 30, idle: 10 } })],
      cursor: {},
    }),
    active: async () => ({}),
    messages: async () => ({
      data: [
        makeAssistant({
          time: { created: 20 },
          retry: { attempt: 2, at: 21, error: { type: "retry", message: "private" } },
        }),
      ],
    }),
    message: async () => makeAssistant(),
  });
  const snapshot = await reader.readParent(
    "ses_parent",
    DEFAULT_OBSERVER_CONFIG,
    new AbortController().signal,
  );
  expect(snapshot.children[0]?.status).toBe("retry");
});

test("part identifiers cannot collide with bounded-priority labels", () => {
  expect(
    limitParts([
      {
        kind: "agent",
        sessionId: "ses_child",
        messageId: "msg_one",
        partId: "running",
        name: "agent",
        observedAt: 1,
      },
      {
        kind: "tool",
        sessionId: "ses_child",
        messageId: "msg_one",
        partId: "tool_one",
        activity: { id: "tool_one", toolName: "search", state: "running", updatedAt: 2 },
      },
    ]),
  ).toHaveLength(2);
});
