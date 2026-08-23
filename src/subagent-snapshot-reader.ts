import type { ObserverConfig } from "./subagent-config.js";
import { sanitizeError } from "./subagent-logger.js";
import type { SubagentLogger } from "./subagent-logger.js";
import {
  normalizeRuntimeStatus,
  projectMessage,
  projectPart,
  projectSession,
  safeCorrelationId,
} from "./subagent-normalizer.js";
import type {
  ObserverRuntimeStatus,
  SafeMessageProjection,
  SafePartProjection,
  SafeSessionProjection,
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

export interface SnapshotSessionClient {
  children(
    parameters: { readonly sessionID: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
  status(
    parameters?: Readonly<Record<string, unknown>>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
  messages(
    parameters: { readonly sessionID: string; readonly limit?: number },
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
  message(
    parameters: { readonly sessionID: string; readonly messageID: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
}

export interface SnapshotSessionState {
  get(sessionID: string): unknown;
  messages(sessionID: string): readonly unknown[];
  status(sessionID: string): unknown;
}

export interface OpenCodeSnapshotReaderDependencies {
  readonly sessionClient: SnapshotSessionClient;
  readonly sessionState: SnapshotSessionState;
  readonly readParts: (messageID: string) => readonly unknown[];
  readonly logger: SubagentLogger;
}

type RecordValue = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataOf(value: unknown): unknown {
  return isRecord(value) ? value.data : undefined;
}

function arrayData(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  const data = dataOf(value);
  return Array.isArray(data) ? data : [];
}

function recordData(value: unknown): RecordValue | undefined {
  const data = dataOf(value);
  return isRecord(data) ? data : isRecord(value) ? value : undefined;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
}

function statusUrgency(status: ObserverRuntimeStatus): number {
  switch (status) {
    case "retry":
    case "error":
      return 0;
    case "busy":
      return 1;
    case "idle":
      return 2;
    case "unknown":
      return 3;
  }
}

function partPriority(part: SafePartProjection): string | undefined {
  switch (part.kind) {
    case "agent":
      return "agent";
    case "subtask":
      return "subtask";
    case "assistant-text":
      return "assistant-text";
    case "public-reasoning-summary":
      return "public-reasoning-summary";
    case "tool":
      return part.activity.state === "running" || part.activity.state === "pending"
        ? part.activity.state
        : undefined;
  }
}

function partObservedAt(part: SafePartProjection): number {
  return part.kind === "tool" ? part.activity.updatedAt : part.observedAt;
}

function limitParts(parts: readonly SafePartProjection[]): readonly SafePartProjection[] {
  const ordered = [...parts].sort(
    (left, right) =>
      partObservedAt(right) - partObservedAt(left) || left.partId.localeCompare(right.partId),
  );
  const preserved = new Map<string, SafePartProjection>();
  for (const part of ordered) {
    const priority = partPriority(part);
    if (priority !== undefined && !preserved.has(priority)) preserved.set(priority, part);
  }
  const selected = [...preserved.values()];
  const selectedIds = new Set(selected.map((part) => part.partId));
  for (const part of ordered) {
    if (selected.length >= PART_REFERENCE_LIMIT) break;
    if (!selectedIds.has(part.partId)) {
      selected.push(part);
      selectedIds.add(part.partId);
    }
  }
  return selected;
}

function projectBundle(bundle: unknown): {
  readonly message?: SafeMessageProjection;
  readonly parts: readonly SafePartProjection[];
} {
  if (!isRecord(bundle)) return { parts: [] };
  const message = projectMessage(bundle.info);
  if (message === undefined) return { parts: [] };
  const observedAt = message.createdAt;
  const parts = Array.isArray(bundle.parts)
    ? bundle.parts
        .map((part) => projectPart(part, { messageRole: message.role, observedAt }))
        .filter((part): part is SafePartProjection => part !== undefined)
    : [];
  return { message, parts };
}

function mergeBundles(bundles: readonly unknown[]): {
  readonly messages: readonly SafeMessageProjection[];
  readonly parts: readonly SafePartProjection[];
} {
  const projected = bundles.map(projectBundle).filter((bundle) => bundle.message !== undefined);
  const messages = projected
    .map((bundle) => bundle.message as SafeMessageProjection)
    .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
    .slice(0, MESSAGE_REFERENCE_LIMIT);
  const messageIds = new Set(messages.map((message) => message.id));
  const parts = limitParts(
    projected
      .filter((bundle) => bundle.message !== undefined && messageIds.has(bundle.message.id))
      .flatMap((bundle) => bundle.parts),
  );
  return { messages, parts };
}

function emptyBundle(): {
  readonly message?: SafeMessageProjection;
  readonly parts: readonly SafePartProjection[];
} {
  return { parts: [] };
}

export function createOpenCodeSnapshotReader(
  deps: OpenCodeSnapshotReaderDependencies,
): ObserverSnapshotReader {
  async function readBundles(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<{
    readonly messages: readonly SafeMessageProjection[];
    readonly parts: readonly SafePartProjection[];
  }> {
    throwIfAborted(signal);
    const result = await deps.sessionClient.messages(
      { sessionID: sessionId, limit: MESSAGE_REFERENCE_LIMIT },
      { signal },
    );
    throwIfAborted(signal);
    return mergeBundles(arrayData(result));
  }

  async function readParent(
    parentSessionId: string,
    config: ObserverConfig,
    signal: AbortSignal,
    ignoredSessionIds: ReadonlySet<string> = new Set(),
  ): Promise<ObserverParentSnapshot> {
    try {
      throwIfAborted(signal);
      const [childrenResult, statusResult] = await Promise.all([
        deps.sessionClient.children({ sessionID: parentSessionId }, { signal }),
        deps.sessionClient.status({}, { signal }),
      ]);
      throwIfAborted(signal);

      const statuses = recordData(statusResult) ?? {};
      const ignored = new Set<string>();
      const candidates: Array<{ session: SafeSessionProjection; status: ObserverRuntimeStatus }> =
        [];
      for (const child of arrayData(childrenResult)) {
        const projected = projectSession(child);
        if (projected === undefined || projected.parentSessionId !== parentSessionId) continue;
        if (ignoredSessionIds.has(projected.id)) {
          ignored.add(projected.id);
          continue;
        }
        candidates.push({
          session: projected,
          status: normalizeRuntimeStatus(statuses[projected.id]),
        });
      }

      candidates.sort(
        (left, right) =>
          statusUrgency(left.status) - statusUrgency(right.status) ||
          right.session.updatedAt - left.session.updatedAt ||
          left.session.id.localeCompare(right.session.id),
      );
      const selected = candidates.slice(0, config.maxTrackedSubagents);
      const children: HydratedSubagent[] = new Array(selected.length);
      let nextIndex = 0;
      const worker = async (): Promise<void> => {
        while (nextIndex < selected.length) {
          const index = nextIndex;
          nextIndex += 1;
          const candidate = selected[index];
          const bundle = await readBundles(candidate.session.id, signal);
          const hasError = bundle.messages.some(
            (message) => message.role === "assistant" && message.hasError,
          );
          children[index] = {
            session: candidate.session,
            status: hasError ? "error" : candidate.status,
            messages: bundle.messages,
            parts: bundle.parts,
          };
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(HYDRATION_CONCURRENCY, selected.length) }, () => worker()),
      );
      return {
        parentSessionId,
        children,
        omittedCount: Math.max(0, candidates.length - selected.length),
        ignoredSessionIdsSeen: [...ignored].sort((left, right) => left.localeCompare(right)),
      };
    } catch (error) {
      if (!isAbortError(error)) {
        deps.logger.warn(`[subagent] snapshot read failed: ${sanitizeError(error)}`);
      }
      throw error;
    }
  }

  async function readMessage(
    sessionId: string,
    messageId: string,
    signal: AbortSignal,
  ): Promise<{
    readonly message?: SafeMessageProjection;
    readonly parts: readonly SafePartProjection[];
  }> {
    try {
      throwIfAborted(signal);
      if (
        safeCorrelationId(sessionId) === undefined ||
        safeCorrelationId(messageId) === undefined
      ) {
        return emptyBundle();
      }
      const localMessage = deps.sessionState.messages(sessionId).find((message) => {
        if (!isRecord(message)) return false;
        const info = isRecord(message.info) ? message.info : message;
        return safeCorrelationId(info.id) === messageId;
      });
      let bundle: unknown;
      if (localMessage !== undefined) {
        if (isRecord(localMessage) && isRecord(localMessage.info)) {
          bundle = { info: localMessage.info, parts: deps.readParts(messageId) };
        } else {
          bundle = { info: localMessage, parts: deps.readParts(messageId) };
        }
      } else {
        const result = await deps.sessionClient.message(
          { sessionID: sessionId, messageID: messageId },
          { signal },
        );
        bundle = dataOf(result);
      }
      throwIfAborted(signal);
      if (bundle === undefined) return emptyBundle();
      return projectBundle(bundle);
    } catch (error) {
      if (!isAbortError(error)) {
        deps.logger.warn(`[subagent] message read failed: ${sanitizeError(error)}`);
      }
      throw error;
    }
  }

  return { readParent, readMessage };
}
