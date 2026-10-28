import { readFileSync } from "node:fs";
import { join } from "node:path";

const STATES = ["WATCHING", "STAGE1_NOTIFIED", "PINGED", "SILENCED", "PAUSED", "IDLE"] as const;
type SessionStatus = (typeof STATES)[number];
export interface AkaneSession {
  readonly state: SessionStatus;
  readonly runningToolsCount: number;
  readonly pendingRequestsCount: number;
  readonly agentName?: string;
  readonly lastActivityAt?: number;
  readonly errorReason?: string;
}
export interface AkaneState {
  readonly version: 1;
  readonly enabled: boolean;
  readonly timestamp: number;
  readonly global: {
    readonly hangupsDetected: number;
    readonly pingsSent: number;
    readonly recoveries: number;
    readonly silencedFailures: number;
  };
  readonly sessions: Readonly<Record<string, AkaneSession>>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function session(value: unknown): value is AkaneSession {
  return (
    record(value) &&
    typeof value.state === "string" &&
    STATES.some((s) => s === value.state) &&
    number(value.runningToolsCount) &&
    number(value.pendingRequestsCount) &&
    (value.agentName === undefined || typeof value.agentName === "string") &&
    (value.errorReason === undefined || typeof value.errorReason === "string") &&
    (value.lastActivityAt === undefined || number(value.lastActivityAt))
  );
}
export function parseAkaneState(value: unknown): AkaneState | undefined {
  if (
    !record(value) ||
    value.version !== 1 ||
    typeof value.enabled !== "boolean" ||
    !number(value.timestamp) ||
    !record(value.global) ||
    !number(value.global.hangupsDetected) ||
    !number(value.global.pingsSent) ||
    !number(value.global.recoveries) ||
    !number(value.global.silencedFailures) ||
    !record(value.sessions) ||
    !Object.values(value.sessions).every(session)
  )
    return undefined;
  const sessions: Record<string, AkaneSession> = {};
  for (const [id, item] of Object.entries(value.sessions)) {
    if (!session(item)) continue;
    sessions[id] = {
      state: item.state,
      runningToolsCount: item.runningToolsCount,
      pendingRequestsCount: item.pendingRequestsCount,
      ...(item.agentName === undefined ? {} : { agentName: item.agentName }),
      ...(item.lastActivityAt === undefined ? {} : { lastActivityAt: item.lastActivityAt }),
      ...(item.errorReason === undefined ? {} : { errorReason: item.errorReason }),
    };
  }
  return {
    version: 1,
    enabled: value.enabled,
    timestamp: value.timestamp,
    global: {
      hangupsDetected: value.global.hangupsDetected,
      pingsSent: value.global.pingsSent,
      recoveries: value.global.recoveries,
      silencedFailures: value.global.silencedFailures,
    },
    sessions,
  };
}
export function readAkaneState(filePath: string): AkaneState | undefined {
  try {
    return parseAkaneState(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return undefined;
  }
}
export function akaneStatePath(directory: string): string {
  return join(directory, ".akane", "watchdog-state.json");
}
export function akaneStateReady(state: AkaneState | undefined, now: number): boolean {
  return (
    state?.enabled === true && state.timestamp <= now + 30_000 && now - state.timestamp <= 90_000
  );
}
export function selectAkaneState(
  primary: AkaneState | undefined,
  alternate: AkaneState | undefined,
  sessionId: string,
  now: number,
): AkaneState | undefined {
  const ready = [primary, alternate].filter((item): item is AkaneState =>
    akaneStateReady(item, now),
  );
  return ready.sort(
    (a, b) =>
      Number(Boolean(b.sessions[sessionId])) - Number(Boolean(a.sessions[sessionId])) ||
      b.timestamp - a.timestamp,
  )[0];
}
