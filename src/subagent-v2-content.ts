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
  let timestamp: unknown;
  if (status === "running") timestamp = time.ran;
  else if (status === "pending") timestamp = time.created;
  else timestamp = time.completed;
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

function projectContentPart(
  part: unknown,
  index: number,
  context: { readonly sessionId: string; readonly messageId: string; readonly observedAt: number },
): SafePartProjection | undefined {
  if (!isRecord(part)) return undefined;
  if (part.type === "text" && typeof part.text === "string") {
    return projectText(part.text, index, context);
  }
  return projectTool(part, context.sessionId, context.messageId, context.observedAt);
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
    const projection = projectContentPart(part, index, {
      ...context,
      sessionId,
      messageId,
    });
    if (projection?.kind === "assistant-text") latestText = projection;
    else if (projection !== undefined) result.push(projection);
  }
  return latestText === undefined ? result : [latestText, ...result];
}
