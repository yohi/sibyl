import { describe, expect, test } from "bun:test";
import {
  normalizeRuntimeStatus,
  projectMessage,
  projectPart,
  projectSession,
  safeCorrelationId,
  safeDisplayIdentifier,
  safeToolName,
} from "../src/subagent-normalizer";

describe("observer safe projections", () => {
  test("projects a tool without inspecting payload, title, output, error, attachments, or metadata", () => {
    const excluded = (field: string): never => {
      throw new Error(`${field}-secret was accessed`);
    };
    const projected = projectPart(
      {
        id: "part-1",
        sessionID: "child",
        messageID: "assistant-1",
        type: "tool",
        callID: "call-1",
        tool: "read",
        get metadata(): never {
          return excluded("part-metadata");
        },
        state: {
          status: "completed",
          time: { start: 10, end: 20 },
          get input(): never {
            return excluded("input");
          },
          get output(): never {
            return excluded("output");
          },
          get title(): never {
            return excluded("title");
          },
          get error(): never {
            return excluded("error");
          },
          get raw(): never {
            return excluded("raw");
          },
          get metadata(): never {
            return excluded("metadata");
          },
          get attachments(): never {
            return excluded("attachment");
          },
        },
      },
      { messageRole: "assistant", observedAt: 20 },
    );

    expect(projected).toEqual({
      kind: "tool",
      sessionId: "child",
      messageId: "assistant-1",
      partId: "part-1",
      activity: { id: "part-1", toolName: "read", state: "completed", updatedAt: 20 },
    });
  });

  test("keeps valid messages when provider and model candidates are unavailable", () => {
    expect(
      projectMessage({
        id: "assistant-invalid-model",
        sessionID: "child",
        role: "assistant",
        time: { created: 10 },
        providerID: "token=provider-secret",
        modelID: "gpt-5.6",
      }),
    ).toEqual({
      id: "assistant-invalid-model",
      sessionId: "child",
      role: "assistant",
      createdAt: 10,
      hasError: false,
    });
    expect(
      projectMessage({
        id: "user-invalid-model",
        sessionID: "child",
        role: "user",
        time: { created: 11 },
        agent: "general",
        model: { providerID: "openai", modelID: "token=model-secret" },
      }),
    ).toEqual({
      id: "user-invalid-model",
      sessionId: "child",
      role: "user",
      createdAt: 11,
      agentName: "general",
    });
    expect(
      projectMessage({
        id: "assistant-valid-model",
        sessionID: "child",
        role: "assistant",
        time: { created: 12 },
        providerID: "openai",
        modelID: "gpt-5.6",
      }),
    ).toMatchObject({ providerId: "openai", modelId: "gpt-5.6" });
  });

  test("does not treat nullish error values as assistant errors", () => {
    const message = {
      id: "assistant-nullish-error",
      sessionID: "child",
      role: "assistant",
      time: { created: 10 },
    } as const;

    expect(projectMessage(message)).toMatchObject({ hasError: false });
    expect(projectMessage({ ...message, error: undefined })).toMatchObject({ hasError: false });
    expect(projectMessage({ ...message, error: null })).toMatchObject({ hasError: false });
    expect(projectMessage({ ...message, error: "failed" })).toMatchObject({ hasError: true });
  });

  test("accepts text only from an Assistant message", () => {
    const textPart = {
      id: "text-1",
      sessionID: "child",
      messageID: "message-1",
      type: "text",
      text: "answer token=secret-value",
    };

    expect(projectPart(textPart, { messageRole: "user", observedAt: 10 })).toBeUndefined();
    expect(projectPart(textPart, { messageRole: "assistant", observedAt: 10 })).toMatchObject({
      kind: "assistant-text",
      text: "answer token=[redacted]",
    });
  });

  test("does not retain secrets disguised as allowlisted identifiers", () => {
    expect(safeCorrelationId("sk-1234567890abcdefgh")).toBeUndefined();
    expect(safeDisplayIdentifier("token=agent-secret")).toBeUndefined();
    expect(safeToolName("ghp_1234567890abcdefgh")).toBe("unknown");
  });

  test("ignores raw reasoning and accepts only an explicitly public top-level summary", () => {
    expect(
      projectPart(
        { type: "reasoning", id: "r1", sessionID: "child", messageID: "a1", text: "raw" },
        { messageRole: "assistant", observedAt: 10 },
      ),
    ).toBeUndefined();

    expect(
      projectPart(
        {
          type: "reasoning",
          id: "r2",
          sessionID: "child",
          messageID: "a1",
          text: "raw-secret",
          summaryVisibility: "public",
          publicSummary: "safe summary token=secret-value",
        },
        { messageRole: "assistant", observedAt: 11 },
      ),
    ).toMatchObject({ kind: "public-reasoning-summary", text: "safe summary token=[redacted]" });
  });

  test("projects sessions and normalizes status without exposing session metadata", () => {
    expect(
      projectSession({
        id: "child-1",
        parentID: "root",
        title: "private title",
        directory: "/private",
        time: { created: 10, updated: 20 },
      }),
    ).toEqual({ id: "child-1", parentSessionId: "root", createdAt: 10, updatedAt: 20 });
    expect(normalizeRuntimeStatus({ type: "busy" })).toBe("busy");
    expect(normalizeRuntimeStatus({ type: "retry" })).toBe("retry");
    expect(normalizeRuntimeStatus({ type: "error" })).toBe("error");
    expect(normalizeRuntimeStatus({ type: "unexpected" })).toBe("unknown");
  });
});
