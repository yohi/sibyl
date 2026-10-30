import { limitParts, type ObserverSnapshotReader } from "./subagent-snapshot-reader.js";
import type {
  OpenCodeClient,
  SessionInfo,
  SessionMessageInfo,
  LocationPublicInfo,
} from "@opencode/client";
import { projectMessage, projectSession } from "./subagent-normalizer.js";
import { projectAssistantContent } from "./subagent-v2-content.js";
import type { HydratedSubagent } from "./subagent-snapshot-reader.js";
import type { SafeSessionProjection } from "./subagent-types.js";

export interface V2SnapshotClient {
  readonly list: (
    input: { readonly parentID: string; readonly cursor?: string },
    signal: AbortSignal,
  ) => Promise<{
    readonly data: readonly SessionInfo[];
    readonly cursor: { readonly next?: string | null };
  }>;
  readonly active: (
    signal: AbortSignal,
  ) => Promise<Readonly<Record<string, { readonly type: "running" }>>>;
  readonly messages: (
    sessionId: string,
    signal: AbortSignal,
  ) => Promise<{ readonly data: readonly SessionMessageInfo[] }>;
  readonly message: (
    sessionId: string,
    messageId: string,
    signal: AbortSignal,
  ) => Promise<SessionMessageInfo>;
}

export async function readSessionLocation(
  client: {
    readonly session: Pick<OpenCodeClient["session"], "get">;
    readonly location: Pick<OpenCodeClient["location"], "get">;
  },
  sessionId: string,
  signal: AbortSignal,
): Promise<LocationPublicInfo | undefined> {
  signal.throwIfAborted();
  const session = await client.session.get({ sessionID: sessionId }, { signal });
  signal.throwIfAborted();
  if (session.id !== sessionId) return undefined;
  const location = await client.location.get({ location: session.location }, { signal });
  signal.throwIfAborted();
  if (location.directory !== session.location.directory) return undefined;
  return location;
}

export function createV2SnapshotReader(client: V2SnapshotClient): ObserverSnapshotReader {
  const readMessage: ObserverSnapshotReader["readMessage"] = async (
    sessionId,
    messageId,
    signal,
  ) => {
    signal.throwIfAborted();
    const raw = await client.message(sessionId, messageId, signal);
    signal.throwIfAborted();
    const message = projectMessage(raw, sessionId);
    if (message === undefined || message.id !== messageId) return { parts: [] };
    return {
      message,
      parts: limitParts(
        projectAssistantContent(raw, {
          sessionId,
          messageId,
          observedAt: message.createdAt,
        }),
      ),
    };
  };
  return {
    async readParent(parentSessionId, config, signal, ignoredSessionIds = new Set()) {
      signal.throwIfAborted();
      const active = await client.active(signal);
      const candidates: {
        session: SafeSessionProjection;
        status: "busy" | "idle" | "error" | "unknown";
        idleAt: number | undefined;
      }[] = [];
      const ignored = new Set<string>();
      let total = 0;
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const page = await client.list(
          { parentID: parentSessionId, ...(cursor === undefined ? {} : { cursor }) },
          signal,
        );
        signal.throwIfAborted();
        for (const item of page.data) {
          const session = projectSession(item);
          if (!session || session.parentSessionId !== parentSessionId) continue;
          if (ignoredSessionIds.has(session.id)) {
            ignored.add(session.id);
            continue;
          }
          total += 1;
          const status = active[session.id]
            ? "busy"
            : item.time.idle === undefined
              ? "unknown"
              : item.outcome === "failed"
                ? "error"
                : item.outcome
                  ? "idle"
                  : "unknown";
          candidates.push({ session, status, idleAt: item.time.idle });
          const rank = { error: 0, busy: 1, idle: 2, unknown: 3 } as const;
          candidates.sort(
            (a, b) =>
              rank[a.status] - rank[b.status] ||
              b.session.updatedAt - a.session.updatedAt ||
              a.session.id.localeCompare(b.session.id),
          );
          if (candidates.length > config.maxTrackedSubagents) candidates.pop();
        }
        const next = page.cursor.next ?? undefined;
        if (next !== undefined) {
          if (cursors.has(next) || cursors.size >= 4096)
            throw new Error("Session pagination cursor repeated or exceeded limit");
          cursors.add(next);
        }
        cursor = next;
      } while (cursor !== undefined);
      const children: HydratedSubagent[] = [];
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(8, candidates.length) }, async () => {
          while (index < candidates.length) {
            const current = index++;
            const candidate = candidates[current];
            if (!candidate) continue;
            const response = await client.messages(candidate.session.id, signal);
            signal.throwIfAborted();
            const messages = response.data.slice(0, 32).flatMap((raw) => {
              const projected = projectMessage(raw, candidate.session.id);
              return projected ? [projected] : [];
            });
            const latestAssistantRecord = response.data.find(
              (message) => message.type === "assistant",
            );
            const retryAt = latestAssistantRecord?.retry?.at;
            const hasCurrentRetry =
              typeof retryAt === "number" &&
              (candidate.idleAt === undefined || retryAt > candidate.idleAt);
            const parts = limitParts(
              response.data.slice(0, 32).flatMap((raw) =>
                projectAssistantContent(raw, {
                  sessionId: candidate.session.id,
                  messageId: raw.id,
                  observedAt: raw.time.created,
                }),
              ),
            );
            const latestAssistant = messages.find((message) => message.role === "assistant");
            const status = hasCurrentRetry
              ? "retry"
              : candidate.status !== "busy" &&
                  latestAssistant !== undefined &&
                  (candidate.idleAt === undefined || latestAssistant.createdAt > candidate.idleAt)
                ? "unknown"
                : candidate.status;
            children[current] = { session: candidate.session, status, messages, parts };
          }
        }),
      );
      return {
        parentSessionId,
        children,
        omittedCount: Math.max(0, total - candidates.length),
        ignoredSessionIdsSeen: [...ignored].sort(),
      };
    },
    readMessage,
  };
}
