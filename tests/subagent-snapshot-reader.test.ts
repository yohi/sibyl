import { describe, expect, test } from "bun:test";
import { DEFAULT_OBSERVER_CONFIG } from "../src/subagent-config";
import {
  createOpenCodeSnapshotReader,
  type OpenCodeSnapshotReaderDependencies,
} from "../src/subagent-snapshot-reader";
import type { SubagentLogger } from "../src/subagent-logger";

class RecordingLogger implements SubagentLogger {
  readonly warnings: string[] = [];

  info(_message: string): void {}

  warn(message: string): void {
    this.warnings.push(message);
  }

  error(message: string): void {
    this.warnings.push(message);
  }
}

function session(id: string, parentID: string, updated: number) {
  return {
    id,
    parentID,
    slug: id,
    projectID: "project",
    directory: "/private",
    title: "private title",
    version: "1",
    time: { created: updated - 1, updated },
  };
}

function assistantBundle(sessionID: string, id: string, created: number, text: string) {
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      time: { created, completed: created + 1 },
      providerID: "openai",
      modelID: "gpt-5.6",
      parentID: "user-1",
      mode: "default",
      agent: "explore",
      path: { cwd: "/private", root: "/private" },
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      {
        id: `text-${id}`,
        sessionID,
        messageID: id,
        type: "text",
        text,
      },
    ],
  };
}

function userBundle(sessionID: string, id: string, created: number, text: string) {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created },
      agent: "general",
      model: { providerID: "openai", modelID: "gpt-5.6" },
      system: text,
    },
    parts: [
      {
        id: `text-${id}`,
        sessionID,
        messageID: id,
        type: "text",
        text,
      },
    ],
  };
}

function fakeSnapshotDependencies(input: {
  readonly children: readonly unknown[];
  readonly statuses?: Readonly<Record<string, unknown>>;
  readonly messages?: Readonly<Record<string, readonly unknown[]>>;
  readonly calls: string[];
  readonly logger?: RecordingLogger;
}): OpenCodeSnapshotReaderDependencies {
  const logger = input.logger ?? new RecordingLogger();
  return {
    sessionClient: {
      children: async ({ sessionID }) => {
        input.calls.push(`children:${sessionID}`);
        return { data: input.children };
      },
      status: async () => ({ data: input.statuses ?? {} }),
      messages: async ({ sessionID }) => {
        input.calls.push(`messages:${sessionID}`);
        return { data: input.messages?.[sessionID] ?? [] };
      },
      message: async ({ sessionID, messageID }) => {
        input.calls.push(`message:${sessionID}:${messageID}`);
        return { data: undefined };
      },
    },
    sessionState: {
      get: () => undefined,
      messages: () => [],
      status: () => undefined,
    },
    readParts: () => [],
    logger,
  };
}

describe("OpenCode snapshot reader", () => {
  test("hydrates only direct children and bounds detailed reads", async () => {
    const calls: string[] = [];
    const reader = createOpenCodeSnapshotReader(
      fakeSnapshotDependencies({
        children: [
          session("child-new", "root", 30),
          session("child-old", "root", 10),
          session("grandchild", "child-old", 40),
        ],
        statuses: { "child-new": { type: "busy" }, "child-old": { type: "idle" } },
        messages: {
          "child-new": [assistantBundle("child-new", "assistant-new", 31, "new answer")],
          "child-old": [userBundle("child-old", "user-old", 11, "private prompt")],
        },
        calls,
      }),
    );

    const result = await reader.readParent(
      "root",
      { ...DEFAULT_OBSERVER_CONFIG, maxTrackedSubagents: 8 },
      new AbortController().signal,
    );

    expect(result.children.map((child) => child.session.id)).toEqual(["child-new", "child-old"]);
    expect(result.ignoredSessionIdsSeen).toEqual([]);
    expect(calls).not.toContain("messages:grandchild");
    expect(JSON.stringify(result)).not.toContain("private prompt");
    expect(result.children[0]).toMatchObject({
      status: "busy",
      messages: [{ role: "assistant" }],
    });
  });

  test("keeps urgent children when the initial snapshot exceeds capacity", async () => {
    const calls: string[] = [];
    const children = Array.from({ length: 9 }, (_, index) =>
      session(`child-${index + 1}`, "root", index + 1),
    );
    const statuses = Object.fromEntries(
      children.map((child, index) => [
        child.id,
        index === 8 ? { type: "retry" } : { type: "idle" },
      ]),
    );
    const reader = createOpenCodeSnapshotReader(
      fakeSnapshotDependencies({ children, statuses, calls }),
    );

    const result = await reader.readParent(
      "root",
      { ...DEFAULT_OBSERVER_CONFIG, maxTrackedSubagents: 8 },
      new AbortController().signal,
    );

    expect(result.omittedCount).toBe(1);
    expect(result.children.map((child) => child.session.id)).toContain("child-9");
  });

  test("reads an Assistant message through the client and never projects User text", async () => {
    const logger = new RecordingLogger();
    const deps = fakeSnapshotDependencies({ children: [], calls: [], logger });
    deps.sessionClient.message = async () => ({
      data: assistantBundle("child", "assistant-1", 10, "answer token=secret-value"),
    });
    const reader = createOpenCodeSnapshotReader(deps);

    const assistant = await reader.readMessage(
      "child",
      "assistant-1",
      new AbortController().signal,
    );
    expect(assistant.message).toMatchObject({ role: "assistant" });
    expect(assistant.parts).toMatchObject([
      { kind: "assistant-text", text: "answer token=[redacted]" },
    ]);

    deps.sessionClient.message = async () => ({
      data: userBundle("child", "user-1", 10, "private prompt"),
    });
    const user = await reader.readMessage("child", "user-1", new AbortController().signal);
    expect(user.message).toMatchObject({ role: "user" });
    expect(user.parts).toEqual([]);
  });

  test("returns an empty safe bundle for a missing message", async () => {
    const reader = createOpenCodeSnapshotReader(
      fakeSnapshotDependencies({ children: [], calls: [] }),
    );
    const result = await reader.readMessage("child", "missing", new AbortController().signal);
    expect(result).toEqual({ parts: [] });
  });

  test("propagates AbortError without logging it as a snapshot failure", async () => {
    const logger = new RecordingLogger();
    const deps = fakeSnapshotDependencies({ children: [], calls: [], logger });
    deps.sessionClient.children = async () => {
      throw new DOMException("cancelled", "AbortError");
    };
    const reader = createOpenCodeSnapshotReader(deps);

    await expect(
      reader.readParent("root", DEFAULT_OBSERVER_CONFIG, new AbortController().signal),
    ).rejects.toHaveProperty("name", "AbortError");
    expect(logger.warnings).toEqual([]);
  });
});
