import { expect, test } from "bun:test";
import { projectAssistantContent } from "../src/subagent-v2-content";
import { projectMessage } from "../src/subagent-normalizer";
import { makeAssistant } from "./helpers/opencode-v2";

test("projects V2 message model and session identity", () => {
  expect(projectMessage(makeAssistant(), "ses_child")).toMatchObject({
    id: "msg_assistant",
    sessionId: "ses_child",
    role: "assistant",
    agentName: "test-agent",
    providerId: "test-provider",
    modelId: "test-model",
  });
});

test("projects assistant text and tool status without sensitive content", () => {
  const result = projectAssistantContent(
    {
      type: "assistant",
      content: [
        { type: "text", text: "password=secretvalue" },
        { type: "reasoning", text: "private-reasoning" },
        {
          type: "tool",
          id: "tool_1",
          name: "read",
          state: { status: "running", input: { secret: "private-input" } },
          time: { created: 1, ran: 2 },
        },
      ],
    },
    { sessionId: "ses_child", messageId: "msg_one", observedAt: 3 },
  );
  expect(result).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain("secretvalue");
  expect(JSON.stringify(result)).not.toContain("private-reasoning");
  expect(JSON.stringify(result)).not.toContain("private-input");
  expect(result[1]).toMatchObject({ kind: "tool", activity: { state: "running" } });
});

test("retains the latest assistant text when a message contains multiple text segments", () => {
  const result = projectAssistantContent(
    {
      type: "assistant",
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "last" },
      ],
    },
    { sessionId: "ses_child", messageId: "msg_one", observedAt: 1 },
  );
  expect(result.filter((part) => part.kind === "assistant-text")).toEqual([
    {
      kind: "assistant-text",
      sessionId: "ses_child",
      messageId: "msg_one",
      partId: "msg_one:content:1",
      text: "last",
      observedAt: 1,
    },
  ]);
});
