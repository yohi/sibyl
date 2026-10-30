import type { SessionInfo, SessionMessageAssistant } from "@opencode/client";

export function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "ses_child",
    parentID: "ses_parent",
    projectID: "project_test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    location: { directory: "/test/project" },
    ...overrides,
  };
}

export function makeAssistant(
  overrides: Partial<SessionMessageAssistant> = {},
): SessionMessageAssistant {
  return {
    id: "msg_assistant",
    type: "assistant",
    agent: "test-agent",
    model: { id: "test-model", providerID: "test-provider" },
    content: [],
    time: { created: 1 },
    ...overrides,
  };
}
