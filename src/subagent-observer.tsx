import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import type { RGBA } from "@opentui/core";
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@opentui/solid";
import type { ObserverConfig } from "./subagent-config.js";
import type { SubagentRegistry } from "./subagent-registry.js";
import type {
  ObserverRuntimeStatus,
  ObserverToolActivity,
  SubagentRuntimeView,
} from "./subagent-types.js";

export interface SidebarObserverProps {
  readonly registry: SubagentRegistry;
  readonly config: ObserverConfig;
  readonly sessionId: string;
  readonly theme: TuiThemeCurrent;
}

export interface SubagentCardProps {
  readonly view: SubagentRuntimeView;
  readonly config: ObserverConfig;
  readonly theme: TuiThemeCurrent;
}

function clip(value: string, limit = 160): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > limit ? `${singleLine.slice(0, limit - 1)}…` : singleLine;
}

function statusColor(status: ObserverRuntimeStatus, theme: TuiThemeCurrent): RGBA {
  switch (status) {
    case "error":
      return theme.error;
    case "retry":
      return theme.warning;
    case "busy":
      return theme.info;
    case "idle":
      return theme.success;
    case "unknown":
      return theme.textMuted;
  }
}

function modelLabel(view: SubagentRuntimeView, config: ObserverConfig): string | undefined {
  const labels: string[] = [];
  if (config.showProvider && view.providerId !== undefined) labels.push(clip(view.providerId, 64));
  if (config.showModel && view.modelId !== undefined) labels.push(clip(view.modelId, 96));
  return labels.length === 0 ? undefined : labels.join(" · ");
}

function activityLabel(activity: ObserverToolActivity): string {
  return `${activity.state.toUpperCase()} ${clip(activity.toolName, 96)}`;
}

export function SubagentCard(props: SubagentCardProps): JSX.Element {
  const color = () => statusColor(props.view.status, props.theme);
  const model = () => modelLabel(props.view, props.config);

  return (
    <box
      border={true}
      borderColor={color()}
      borderStyle="single"
      flexDirection="column"
      flexShrink={0}
      padding={1}
      width="100%"
    >
      <text
        content={`${clip(props.view.agentName, 80)} · ${props.view.status.toUpperCase()}`}
        fg={color()}
      />
      <Show when={props.view.currentActivity}>
        {(activity) => <text content={activityLabel(activity())} fg={props.theme.textMuted} />}
      </Show>
      <Show when={model()}>{(label) => <text content={label()} fg={props.theme.textMuted} />}</Show>
      <Show when={props.config.showLatestText ? props.view.latestAssistantText : undefined}>
        {(text) => <text content={clip(text())} fg={props.theme.text} />}
      </Show>
      <Show
        when={props.config.showReasoningSummary ? props.view.publicReasoningSummary : undefined}
      >
        {(summary) => <text content={`Reasoning: ${clip(summary())}`} fg={props.theme.textMuted} />}
      </Show>
    </box>
  );
}

export function SidebarObserver(props: SidebarObserverProps): JSX.Element {
  const [snapshot, setSnapshot] = createSignal(props.registry.snapshot());
  let selectedParent: string | undefined;

  if (props.config.enabled) {
    const unsubscribe = props.registry.subscribe(() => setSnapshot(props.registry.snapshot()));
    onCleanup(unsubscribe);
    createEffect(() => {
      if (selectedParent === props.sessionId) return;
      selectedParent = props.sessionId;
      void props.registry.selectParent(props.sessionId);
    });
  }

  const visibleViews = () => {
    const current = snapshot();
    if (!props.config.enabled || !current.ready || current.parentSessionId !== props.sessionId)
      return [];
    return current.views.slice(0, props.config.maxVisibleSubagents);
  };

  const omittedCount = () => {
    const current = snapshot();
    const visibleLimit = Math.max(0, props.config.maxVisibleSubagents);
    return current.overflowCount + Math.max(0, current.views.length - visibleLimit);
  };

  return (
    <scrollbox
      contentOptions={{ flexDirection: "column" }}
      height="100%"
      scrollbarOptions={{ trackOptions: { backgroundColor: props.theme.backgroundPanel } }}
      width="100%"
    >
      <For each={visibleViews()}>
        {(view) => <SubagentCard view={view} config={props.config} theme={props.theme} />}
      </For>
      <Show when={omittedCount() > 0 ? omittedCount() : undefined}>
        {(count) => <text content={`+${count()} omitted`} fg={props.theme.textMuted} />}
      </Show>
    </scrollbox>
  );
}
