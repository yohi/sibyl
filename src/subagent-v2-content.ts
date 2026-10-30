import type { SafePartProjection } from "./subagent-types.js";
import { safeCorrelationId, safeToolName } from "./subagent-normalizer.js";
import { redactAndTruncate } from "./subagent-redaction.js";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function projectAssistantContent(
  value: unknown,
  context: { readonly sessionId: string; readonly messageId: string; readonly observedAt: number },
): readonly SafePartProjection[] {
  if (!isRecord(value) || value.type !== "assistant" || !Array.isArray(value.content)) return [];
  const sessionId = safeCorrelationId(context.sessionId);
  const messageId = safeCorrelationId(context.messageId);
  if (sessionId === undefined || messageId === undefined) return [];
  const result: SafePartProjection[] = [];
  let latestText: SafePartProjection | undefined;
  for (const [index, part] of value.content.entries()) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") {
      const partId = safeCorrelationId(`${messageId}:content:${index}`);
      if (partId !== undefined) {
        latestText = {
          kind: "assistant-text",
          sessionId,
          messageId,
          partId,
          text: redactAndTruncate(part.text, 160),
          observedAt: context.observedAt,
        };
      }
    } else if (part.type === "tool" && isRecord(part.state)) {
      const partId = safeCorrelationId(part.id);
      if (partId === undefined) continue;
      const status = part.state.status === "streaming" ? "pending" : part.state.status;
      if (
        status !== "pending" &&
        status !== "running" &&
        status !== "completed" &&
        status !== "error"
      )
        continue;
      const time = isRecord(part.time) ? part.time : {};
      const timestamp =
        status === "running" ? time.ran : status === "pending" ? time.created : time.completed;
      result.push({
        kind: "tool",
        sessionId,
        messageId,
        partId,
        activity: {
          id: partId,
          toolName: safeToolName(part.name),
          state: status,
          updatedAt:
            typeof timestamp === "number" && Number.isFinite(timestamp)
              ? timestamp
              : context.observedAt,
        },
      });
    }
  }
  return latestText === undefined ? result : [latestText, ...result];
}
