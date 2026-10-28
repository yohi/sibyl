import type { TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RGBA } from "@opentui/core";
import { Show, createSignal, onCleanup } from "solid-js";
import { AkaneSidebar } from "./akane-sidebar.js";
import { agentColor } from "./akane-color.js";
import {
  akaneStatePath,
  readAkaneState,
  selectAkaneState,
  type AkaneState,
} from "./akane-state.js";
import type { ObserverConfig } from "./subagent-config.js";
import { SidebarObserver } from "./subagent-observer.js";
import type { SubagentRegistry } from "./subagent-registry.js";
import { createCategoryResolver } from "./tui-category.js";

export function IntegratedSidebar(props: {
  readonly api: Pick<TuiPluginApi, "state" | "lifecycle" | "event" | "client">;
  readonly sessionId: string;
  readonly theme: TuiThemeCurrent;
  readonly config: ObserverConfig;
  readonly registry?: SubagentRegistry;
}) {
  const [state, setState] = createSignal<AkaneState>();
  const [colors, setColors] = createSignal<Record<string, RGBA | undefined>>({});
  let disposed = false;
  const refreshColors = async () => {
    const directory = props.api.state.path?.worktree || props.api.state.path?.directory;
    if (!props.api.client.app?.agents || !directory) return;
    try {
      const response = await props.api.client.app.agents({ directory });
      if (disposed || !Array.isArray(response.data)) return;
      const theme = props.theme;
      const palette = {
        primary: theme.primary,
        secondary: theme.secondary,
        accent: theme.accent,
        error: theme.error,
        warning: theme.warning,
        success: theme.success,
        info: theme.info,
      };
      const values: Record<string, RGBA | undefined> = {};
      for (const agent of response.data)
        if (agent.color) values[agent.name] = agentColor(agent.color, palette);
      setColors(values);
    } catch {
      /* Agent profiles are optional and must not interrupt rendering. */
    }
  };
  const [categoryVersion, setCategoryVersion] = createSignal(0);
  const resolver = createCategoryResolver();
  const changed = () => setCategoryVersion((value) => value + 1);
  const unsubscribers = [
    props.api.event.on("session.next.tool.called", (event) => {
      resolver.observeToolCall(
        event.properties.sessionID,
        event.properties.tool,
        event.properties.input,
        event.properties.callID,
      );
      changed();
    }),
    props.api.event.on("session.next.tool.success", (event) => {
      resolver.observeToolSettled(event.properties.sessionID, event.properties.callID, "success");
      changed();
    }),
    props.api.event.on("session.next.tool.failed", (event) => {
      resolver.observeToolSettled(event.properties.sessionID, event.properties.callID, "failure");
      changed();
    }),
    props.api.event.on("session.created", (event) => {
      resolver.observeSessionCreated(event.properties.info);
      changed();
    }),
    props.api.event.on("session.deleted", (event) => {
      resolver.evict(event.properties.info.id);
      changed();
    }),
  ];
  const categoryFor = (id: string): string | undefined => {
    categoryVersion();
    const child = props.api.state.session.get(id);
    if (!child || child.parentID !== props.sessionId) return undefined;
    const parts = props.api.state.session
      .messages(props.sessionId)
      .flatMap((message) => props.api.state.part(message.id));
    const result = resolver.resolve(child, parts);
    return result.kind === "resolved" ? result.category : undefined;
  };
  let hadAvailableState = false;
  const refresh = () => {
    const paths = props.api.state.path;
    const directory = paths?.worktree || paths?.directory;
    const primary = paths?.worktree ? readAkaneState(akaneStatePath(paths.worktree)) : undefined;
    const alternate = paths?.directory
      ? readAkaneState(akaneStatePath(paths.directory))
      : undefined;
    const availableState = selectAkaneState(primary, alternate, props.sessionId, Date.now());
    setState(availableState);
    if (availableState === undefined) {
      hadAvailableState = false;
      return;
    }
    if (!hadAvailableState) void refreshColors();
    hadAvailableState = true;
    if (!props.registry) return;
    resolver.refresh({
      ...(directory ? { taskDirectory: join(directory, ".omo", "senpi-task", "tasks") } : {}),
      teamRuntimeDirectory: join(homedir(), ".omo", "runtime"),
    });
    changed();
  };
  refresh();
  const timer = setInterval(refresh, 1000);
  const colorTimer = setInterval(() => {
    if (state() !== undefined) void refreshColors();
  }, 30_000);
  const stop = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    clearInterval(colorTimer);
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
  props.api.lifecycle.signal.addEventListener("abort", stop, { once: true });
  onCleanup(() => {
    stop();
    props.api.lifecycle.signal.removeEventListener("abort", stop);
  });
  return (
    <Show when={state()}>
      {(available) => (
        <box flexDirection="column">
          <AkaneSidebar
            state={available()}
            sessionId={props.sessionId}
            theme={props.theme}
            branch={props.api.state.vcs?.branch ?? "-"}
            worktree={
              (props.api.state.path?.worktree || props.api.state.path?.directory || "-")
                .split(/[\\/]/)
                .filter(Boolean)
                .at(-1) ?? "-"
            }
            now={Date.now()}
            agentColors={colors()}
          />
          <Show when={props.registry}>
            {(registry) => (
              <SidebarObserver
                registry={registry()}
                config={props.config}
                sessionId={props.sessionId}
                theme={props.theme}
                categoryFor={categoryFor}
              />
            )}
          </Show>
        </box>
      )}
    </Show>
  );
}
