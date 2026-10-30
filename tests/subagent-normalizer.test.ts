import { describe, expect, test } from "bun:test";
import {
  normalizeRuntimeStatus,
  projectMessage,
  projectSession,
  safeCorrelationId,
  safeDisplayIdentifier,
  safeToolName,
} from "../src/subagent-normalizer";
import { makeAssistant } from "./helpers/opencode-v2";

describe("V2 safe record projections", () => {
  test("projects only validated session identity, times and title category", () => {
    expect(
      projectSession({
        id: "ses_child",
        parentID: "ses_parent",
        title: "[quick] harmless title",
        location: { directory: "/private/path" },
        metadata: { token: "do-not-store" },
        time: { created: 10, updated: 20 },
      }),
    ).toEqual({
      id: "ses_child",
      parentSessionId: "ses_parent",
      createdAt: 10,
      updatedAt: 20,
      category: "quick",
    });
  });

  test("projects assistant identity and model from the owner session", () => {
    const projected = projectMessage(
      makeAssistant({
        native: { secret: "do-not-store" },
        metadata: { token: "do-not-store" },
      }),
      "ses_child",
    );
    expect(projected).toMatchObject({
      id: "msg_assistant",
      sessionId: "ses_child",
      role: "assistant",
      agentName: "test-agent",
      providerId: "test-provider",
      modelId: "test-model",
    });
    expect(JSON.stringify(projected)).not.toContain("do-not-store");
  });

  test("retains a safe user display record and excludes other message kinds", () => {
    expect(
      projectMessage(
        {
          id: "msg_user",
          type: "user",
          time: { created: 11 },
          agent: "general",
          model: { providerID: "openai", modelID: "gpt-5.6" },
          text: "secret prompt",
        },
        "ses_child",
      ),
    ).toEqual({
      id: "msg_user",
      sessionId: "ses_child",
      role: "user",
      createdAt: 11,
      agentName: "general",
      providerId: "openai",
      modelId: "gpt-5.6",
    });
    expect(
      projectMessage({ id: "msg_system", type: "system", time: { created: 12 } }, "ses_child"),
    ).toBeUndefined();
  });

  test("rejects unsafe IDs and display values", () => {
    expect(safeCorrelationId("sk-1234567890abcdefgh")).toBeUndefined();
    expect(safeDisplayIdentifier("token=agent-secret")).toBeUndefined();
    expect(safeToolName("ghp_1234567890abcdefgh")).toBe("unknown");
  });

  test("normalizes V2 runtime status without exposing other fields", () => {
    expect(normalizeRuntimeStatus({ type: "busy", token: "private" })).toBe("busy");
    expect(normalizeRuntimeStatus({ type: "retry" })).toBe("retry");
    expect(normalizeRuntimeStatus({ type: "unexpected" })).toBe("unknown");
  });
});
