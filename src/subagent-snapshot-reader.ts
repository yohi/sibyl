import type { ObserverConfig } from "./subagent-config.js";
import type {
  ObserverRuntimeStatus,
  SafeMessageProjection,
  SafePartProjection,
  SafeSessionProjection,
  SubagentRuntimeView,
} from "./subagent-types.js";

export const MESSAGE_REFERENCE_LIMIT = 32;
export const PART_REFERENCE_LIMIT = 64;
export const HYDRATION_CONCURRENCY = 8;

export interface HydratedSubagent {
  readonly session: SafeSessionProjection;
  readonly status: ObserverRuntimeStatus;
  readonly messages: readonly SafeMessageProjection[];
  readonly parts: readonly SafePartProjection[];
}

export interface ObserverParentSnapshot {
  readonly parentSessionId: string;
  readonly children: readonly HydratedSubagent[];
  readonly omittedCount: number;
  readonly ignoredSessionIdsSeen: readonly string[];
}

export interface ObserverSnapshotReader {
  readParent(
    parentSessionId: string,
    config: ObserverConfig,
    signal: AbortSignal,
    ignoredSessionIds?: ReadonlySet<string>,
  ): Promise<ObserverParentSnapshot>;
  readMessage(
    sessionId: string,
    messageId: string,
    signal: AbortSignal,
  ): Promise<{
    readonly message?: SafeMessageProjection;
    readonly parts: readonly SafePartProjection[];
  }>;
}

type ToolPart = Extract<SafePartProjection, { readonly kind: "tool" }>;
type PriorityPart = Extract<
  SafePartProjection,
  { readonly kind: "agent" | "subtask" | "assistant-text" | "public-reasoning-summary" }
>;

function isToolPart(part: SafePartProjection): part is ToolPart {
  return part.kind === "tool";
}
function isPriorityPart(part: SafePartProjection): part is PriorityPart {
  return part.kind !== "tool";
}
function partTime(part: SafePartProjection): number {
  return isToolPart(part) ? part.activity.updatedAt : part.observedAt;
}

function priority(part: PriorityPart): string {
  return part.kind;
}

export function limitParts(parts: readonly SafePartProjection[]): readonly SafePartProjection[] {
  const ordered = [...parts].sort(
    (a, b) => partTime(b) - partTime(a) || a.partId.localeCompare(b.partId),
  );
  const selected: SafePartProjection[] = [];
  const selectedIds = new Set<string>();
  const priorities = new Set<string>();
  for (const part of ordered) {
    if (isPriorityPart(part) && !priorities.has(priority(part))) {
      priorities.add(priority(part));
      selected.push(part);
      selectedIds.add(part.partId);
    }
    if (
      isToolPart(part) &&
      (part.activity.state === "running" || part.activity.state === "pending") &&
      !priorities.has(part.activity.state)
    ) {
      priorities.add(part.activity.state);
      selected.push(part);
      selectedIds.add(part.partId);
    }
  }
  for (const part of ordered) {
    if (selected.length >= PART_REFERENCE_LIMIT) break;
    if (selectedIds.has(part.partId)) continue;
    selected.push(part);
    selectedIds.add(part.partId);
  }
  return selected.slice(0, PART_REFERENCE_LIMIT);
}

export type { SubagentRuntimeView };
