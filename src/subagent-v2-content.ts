import type { SafePartProjection } from "./subagent-types.js";
import { safeCorrelationId, safeToolName } from "./subagent-normalizer.js";
import { redactAndTruncate } from "./subagent-redaction.js";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectText(
  text: string,
  index: number,
  context: { readonly sessionId: string; readonly messageId: string; readonly observedAt: number },
): SafePartProjection | undefined {
  const partId = safeCorrelationId(`${context.messageId}:content:${index}`);
  return partId === undefined
    ? undefined
    : {
        kind: "assistant-text",
        sessionId: context.sessionId,
        messageId: context.messageId,
        partId,
        text: redactAndTruncate(text, 160),
        observedAt: context.observedAt,
      };
}

function projectTool(
  part: Readonly<Record<string, unknown>>,
  sessionId: string,
  messageId: string,
  observedAt: number,
): SafePartProjection | undefined {
  if (part.type !== "tool" || !isRecord(part.state)) return undefined;
  const partId = safeCorrelationId(part.id);
  if (partId === undefined) return undefined;
  const status = part.state.status === "streaming" ? "pending" : part.state.status;
  if (status !== "pending" && status !== "running" && status !== "completed" && status !== "error")
    return undefined;
  const time = isRecord(part.time) ? part.time : {};
  const timestamp =
    status === "running" ? time.ran : status === "pending" ? time.created : time.completed;
  return {
    kind: "tool",
    sessionId,
    messageId,
    partId,
    activity: {
      id: partId,
      toolName: safeToolName(part.name),
      state: status,
      updatedAt:
        typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : observedAt,
    },
  };
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
      const text = projectText(part.text, index, { ...context, sessionId, messageId });
      if (text !== undefined) latestText = text;
    } else {
      const tool = projectTool(part, sessionId, messageId, context.observedAt);
      if (tool !== undefined) result.push(tool);
    }
  }
  return latestText === undefined ? result : [latestText, ...result];
}
