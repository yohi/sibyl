import {
  CORRELATION_ID_LIMIT,
  DISPLAY_IDENTIFIER_LIMIT,
  LATEST_TEXT_LIMIT,
  REASONING_SUMMARY_LIMIT,
  TOOL_NAME_LIMIT,
  redactAndTruncate,
} from "./subagent-redaction.js";
import type {
  ObserverRuntimeStatus,
  ObserverToolState,
  ObserverToolActivity,
  SafeMessageProjection,
  SafePartProjection,
  SafeSessionProjection,
} from "./subagent-types.js";

type RecordValue = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeIdentifier(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) return undefined;
  const redacted = redactAndTruncate(value, maximum);
  if (redacted !== value) return undefined;
  return /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/u.test(value) ? value : undefined;
}

export function safeCorrelationId(value: unknown): string | undefined {
  return safeIdentifier(value, CORRELATION_ID_LIMIT);
}

export function safeDisplayIdentifier(value: unknown): string | undefined {
  return safeIdentifier(value, DISPLAY_IDENTIFIER_LIMIT);
}

export function safeToolName(value: unknown): string {
  return safeIdentifier(value, TOOL_NAME_LIMIT) ?? "unknown";
}

export function projectSession(value: unknown): SafeSessionProjection | undefined {
  if (!isRecord(value)) return undefined;
  const id = safeCorrelationId(value.id);
  const time = isRecord(value.time) ? value.time : undefined;
  const createdAt = finiteNumber(time?.created);
  const updatedAt = finiteNumber(time?.updated);
  if (id === undefined || createdAt === undefined || updatedAt === undefined) return undefined;

  const parentValue = value.parentID;
  const parentSessionId = parentValue === undefined ? undefined : safeCorrelationId(parentValue);
  if (parentValue !== undefined && parentSessionId === undefined) return undefined;
  return parentSessionId === undefined
    ? { id, createdAt, updatedAt }
    : { id, parentSessionId, createdAt, updatedAt };
}

export function normalizeRuntimeStatus(value: unknown): ObserverRuntimeStatus {
  const status = typeof value === "string" ? value : isRecord(value) ? value.type : undefined;
  switch (status) {
    case "busy":
      return "busy";
    case "idle":
      return "idle";
    case "retry":
      return "retry";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}

function modelCandidate(
  provider: unknown,
  model: unknown,
): { readonly providerId: string; readonly modelId: string } | undefined {
  const providerId = safeDisplayIdentifier(provider);
  const modelId = safeDisplayIdentifier(model);
  return providerId === undefined || modelId === undefined ? undefined : { providerId, modelId };
}

function withModel<T extends object>(
  base: T,
  provider: unknown,
  model: unknown,
): T & { readonly providerId?: string; readonly modelId?: string } {
  const candidate = modelCandidate(provider, model);
  return candidate === undefined ? base : { ...base, ...candidate };
}

export function projectMessage(value: unknown): SafeMessageProjection | undefined {
  if (!isRecord(value)) return undefined;
  const id = safeCorrelationId(value.id);
  const sessionId = safeCorrelationId(value.sessionID);
  const role = value.role;
  const time = isRecord(value.time) ? value.time : undefined;
  const createdAt = finiteNumber(time?.created);
  if (id === undefined || sessionId === undefined || createdAt === undefined) return undefined;

  if (role === "user") {
    const agentName = safeDisplayIdentifier(value.agent) ?? "unknown";
    const model = isRecord(value.model) ? value.model : undefined;
    return withModel(
      {
        id,
        sessionId,
        role: "user",
        createdAt,
        agentName,
      },
      model?.providerID,
      model?.modelID,
    ) as SafeMessageProjection;
  }

  if (role !== "assistant") return undefined;
  const completedAt = finiteNumber(time?.completed);
  const base = {
    id,
    sessionId,
    role: "assistant" as const,
    createdAt,
    ...(completedAt === undefined ? {} : { completedAt }),
    hasError: Object.hasOwn(value, "error"),
  };
  return withModel(base, value.providerID, value.modelID) as SafeMessageProjection;
}

export interface ProjectPartContext {
  readonly messageRole: "user" | "assistant" | undefined;
  readonly observedAt: number;
}

function partIdentifiers(
  value: RecordValue,
  allowToolFallback = false,
): { readonly sessionId: string; readonly messageId: string; readonly partId: string } | undefined {
  const sessionId = safeCorrelationId(value.sessionID);
  const messageId = safeCorrelationId(value.messageID);
  const rawPartId = value.id;
  const partId =
    safeCorrelationId(rawPartId) ??
    (allowToolFallback && rawPartId === undefined ? safeCorrelationId(value.callID) : undefined);
  if (sessionId === undefined || messageId === undefined || partId === undefined) return undefined;
  return { sessionId, messageId, partId };
}

function observedTime(value: unknown, fallback: number): number {
  return finiteNumber(value) ?? fallback;
}

function projectTool(
  value: RecordValue,
  identifiers: { readonly sessionId: string; readonly messageId: string; readonly partId: string },
  context: ProjectPartContext,
): SafePartProjection | undefined {
  if (!isRecord(value.state)) return undefined;
  const state = value.state;
  const stateName = state.status;
  let toolState: ObserverToolState;
  let updatedAt = context.observedAt;
  switch (stateName) {
    case "pending":
      toolState = "pending";
      break;
    case "running":
      toolState = "running";
      updatedAt = observedTime(isRecord(state.time) ? state.time.start : undefined, updatedAt);
      break;
    case "completed":
      toolState = "completed";
      updatedAt = observedTime(isRecord(state.time) ? state.time.end : undefined, updatedAt);
      break;
    case "error":
      toolState = "error";
      updatedAt = observedTime(isRecord(state.time) ? state.time.end : undefined, updatedAt);
      break;
    default:
      return undefined;
  }

  const activity: ObserverToolActivity = {
    id: identifiers.partId,
    toolName: safeToolName(value.tool),
    state: toolState,
    updatedAt,
  };
  return { kind: "tool", ...identifiers, activity };
}

export function projectPart(
  value: unknown,
  context: ProjectPartContext,
): SafePartProjection | undefined {
  if (!isRecord(value)) return undefined;
  const type = value.type;
  const identifiers = partIdentifiers(value, type === "tool");
  if (identifiers === undefined) return undefined;

  if (type === "agent") {
    return {
      kind: "agent",
      ...identifiers,
      name: safeDisplayIdentifier(value.name) ?? "unknown",
      observedAt: context.observedAt,
    };
  }
  if (type === "subtask") {
    return {
      kind: "subtask",
      ...identifiers,
      agent: safeDisplayIdentifier(value.agent) ?? "unknown",
      observedAt: context.observedAt,
    };
  }
  if (type === "text") {
    if (context.messageRole !== "assistant" || typeof value.text !== "string") return undefined;
    return {
      kind: "assistant-text",
      ...identifiers,
      text: redactAndTruncate(value.text, LATEST_TEXT_LIMIT),
      observedAt: context.observedAt,
    };
  }
  if (type === "reasoning") {
    if (value.summaryVisibility !== "public" || typeof value.publicSummary !== "string") {
      return undefined;
    }
    return {
      kind: "public-reasoning-summary",
      ...identifiers,
      text: redactAndTruncate(value.publicSummary, REASONING_SUMMARY_LIMIT),
      observedAt: context.observedAt,
    };
  }
  if (type === "tool") return projectTool(value, identifiers, context);
  return undefined;
}

export function readPartIdentifiers(
  value: unknown,
): { readonly sessionId: string; readonly messageId: string; readonly partId: string } | undefined {
  return isRecord(value) ? partIdentifiers(value) : undefined;
}
