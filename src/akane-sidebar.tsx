import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import type { RGBA } from "@opentui/core";
import { Show } from "solid-js";
import type { AkaneState } from "./akane-state.js";
import { redactAndTruncate } from "./subagent-redaction.js";

export function AkaneSidebar(props: {
  readonly state: AkaneState;
  readonly sessionId: string;
  readonly theme: TuiThemeCurrent;
  readonly branch?: string;
  readonly worktree?: string;
  readonly now?: number;
  readonly agentColors?: Readonly<Record<string, RGBA | undefined>>;
}) {
  const current = () => props.state.sessions[props.sessionId];
  const active = () =>
    Object.values(props.state.sessions).filter((item) => item.state !== "IDLE").length;
  return (
    <box border>
      <text>
        <strong
          style={{ fg: props.agentColors?.[current()?.agentName ?? ""] ?? props.theme.accent }}
        >
          Akane Watchdog
        </strong>
        <br />
        Branch: {redactAndTruncate(props.branch ?? "-", 64)}
        <br />
        Worktree: {redactAndTruncate(props.worktree ?? "-", 64)}
        <br />
        Plugin: Enabled
        <br />
        <br />
        <strong style={{ fg: props.theme.accent }}>Telemetry</strong>
        <br />
        Active sessions: {active()}
        <br />
        Hangups: {props.state.global.hangupsDetected}
        <br />
        Pings: {props.state.global.pingsSent}
        <br />
        Recoveries: {props.state.global.recoveries}
        <br />
        Silenced: {props.state.global.silencedFailures}
        <br />
        <br />
        <strong
          style={{ fg: props.agentColors?.[current()?.agentName ?? ""] ?? props.theme.accent }}
        >
          This session
        </strong>
        <br />
        State: {current()?.state ?? "Not tracked"}
        <br />
        Agent:{" "}
        <span style={{ fg: props.agentColors?.[current()?.agentName ?? ""] ?? props.theme.text }}>
          {redactAndTruncate(current()?.agentName ?? "-", 64)}
        </span>
        <br />
        Tools running: {current()?.runningToolsCount ?? 0}
        <br />
        Pending: {current()?.pendingRequestsCount ?? 0}
        <br />
        Last activity:{" "}
        {current()?.lastActivityAt === undefined
          ? "-"
          : `${Math.max(0, Math.floor(((props.now ?? Date.now()) - (current()?.lastActivityAt ?? 0)) / 1000))}s ago`}
        <br />
        <Show when={current()?.errorReason}>
          {(reason) => <span>Error: {redactAndTruncate(reason(), 64)}</span>}
        </Show>
      </text>
    </box>
  );
}
