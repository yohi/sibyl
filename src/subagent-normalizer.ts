import {
  CORRELATION_ID_LIMIT,
  DISPLAY_IDENTIFIER_LIMIT,
  TOOL_NAME_LIMIT,
  redactAndTruncate,
} from "./subagent-redaction.js";
import type {
  ObserverRuntimeStatus,
  SafeMessageProjection,
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
  const match =
    typeof value.title === "string"
      ? /^\[([A-Za-z0-9][A-Za-z0-9_-]{0,63})\]\s/u.exec(value.title)
      : null;
  const category = safeDisplayIdentifier(match?.[1]);
  const base = { id, createdAt, updatedAt, ...(category === undefined ? {} : { category }) };
  return parentSessionId === undefined ? base : { ...base, parentSessionId };
}

export function normalizeRuntimeStatus(value: unknown): ObserverRuntimeStatus {
  let status: unknown;
  if (typeof value === "string") {
    status = value;
  } else if (isRecord(value)) {
    status = value.type;
  } else {
    status = undefined;
  }
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
): T | (T & { readonly providerId: string; readonly modelId: string }) {
  const candidate = modelCandidate(provider, model);
  return candidate === undefined ? base : { ...base, ...candidate };
}

export function projectMessage(
  value: unknown,
  ownerSessionId: string,
): SafeMessageProjection | undefined {
  if (!isRecord(value)) return undefined;
  const id = safeCorrelationId(value.id);
  const sessionId = safeCorrelationId(ownerSessionId);
  const role = value.type;
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
        role: "user" as const,
        createdAt,
        agentName,
      },
      model?.providerID,
      model?.modelID,
    );
  }

  if (role !== "assistant") return undefined;
  const completedAt = finiteNumber(time?.completed);
  const base = {
    id,
    sessionId,
    role: "assistant" as const,
    createdAt,
    ...(safeDisplayIdentifier(value.agent) === undefined
      ? {}
      : { agentName: safeDisplayIdentifier(value.agent) }),
    ...(completedAt === undefined ? {} : { completedAt }),
    hasError: Object.hasOwn(value, "error") && value.error !== undefined && value.error !== null,
  };
  const model = isRecord(value.model) ? value.model : undefined;
  return withModel(base, model?.providerID ?? value.providerID, model?.id ?? value.modelID);
}
