import type { Plugin } from "@opencode/plugin/tui";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RGBA } from "@opentui/core";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { AkaneSidebar } from "./akane-sidebar.js";
import {
  akaneStatePath,
  readAkaneState,
  selectAkaneState,
  type AkaneState,
} from "./akane-state.js";
import type { ObserverConfig } from "./subagent-config.js";
import { consoleSubagentLogger } from "./subagent-logger.js";
import { SidebarObserver } from "./subagent-observer.js";
import { createObserverReconciler } from "./subagent-reconciler.js";
import { SubagentRegistry } from "./subagent-registry.js";
import { V2EventSource } from "./subagent-v2-events.js";
import { createV2SnapshotReader, readSessionLocation } from "./subagent-v2-snapshot.js";
import { createCategoryResolver } from "./tui-category.js";
import { agentColor } from "./akane-color.js";

export function SidebarV2(props: {
  readonly context: Plugin.Context;
  readonly config: ObserverConfig;
  readonly sessionId: string;
  readonly registerCleanup: (cleanup: () => Promise<void>) => () => void;
}) {
  const { context } = props;
  const [state, setState] = createSignal<AkaneState>();
  const [directory, setDirectory] = createSignal<string>();
  const [branch, setBranch] = createSignal<string>();
  const [colors, setColors] = createSignal<Record<string, RGBA | undefined>>({});
  const [categoryVersion, setCategoryVersion] = createSignal(0);
  const [locationVersion, setLocationVersion] = createSignal(0);
  const category = createCategoryResolver();
  const toolNames = new Map<string, string>();
  const controller = new AbortController();
  const registry = props.config.enabled
    ? new SubagentRegistry({
        config: props.config,
        logger: consoleSubagentLogger,
        eventSource: new V2EventSource(context.data),
        snapshotReader: createV2SnapshotReader({
          list: (input, signal) =>
            context.client.session.list({ ...input, limit: 256, order: "desc" }, { signal }),
          active: (signal) => context.client.session.active({ signal }),
          messages: (sessionID, signal) =>
            context.client.message.list({ sessionID, limit: 32, order: "desc" }, { signal }),
          message: (sessionID, messageID, signal) =>
            context.client.session.message.get({ sessionID, messageID }, { signal }),
        }),
      })
    : undefined;
  const reconciler = createObserverReconciler({
    refresh: () => registry?.resyncNow() ?? Promise.resolve(),
    logger: consoleSubagentLogger,
  });
  const theme = () => ({
    primary: context.theme.text.action.primary.base,
    secondary: context.theme.text.action.secondary.base,
    accent: context.theme.hue.accent[500],
    error: context.theme.text.feedback.error.base,
    warning: context.theme.text.feedback.warning.base,
    success: context.theme.text.feedback.success.base,
    info: context.theme.text.feedback.info.base,
    text: context.theme.text.base,
    textMuted: context.theme.text.muted,
    backgroundPanel: context.theme.background.raised.base,
  });
  const unsubscribe = context.data.listen(({ details }) => {
    switch (details.type) {
      case "session.tool.input.started":
        if (toolNames.size >= 256) {
          const oldest = toolNames.keys().next().value;
          if (oldest !== undefined) toolNames.delete(oldest);
        }
        toolNames.set(details.data.id, details.data.name);
        break;
      case "session.tool.called":
        category.observeToolCall(
          details.data.sessionID,
          toolNames.get(details.data.id) ?? "",
          details.data.input,
          details.data.id,
        );
        break;
      case "session.tool.success":
      case "session.tool.failed":
        category.observeToolSettled(
          details.data.sessionID,
          details.data.id,
          details.type === "session.tool.success" ? "success" : "failure",
        );
        toolNames.delete(details.data.id);
        break;
      case "session.deleted":
        category.evict(details.data.sessionID);
        if (details.data.sessionID === props.sessionId)
          setLocationVersion((version) => version + 1);
        break;
      case "session.moved":
        if (details.data.sessionID === props.sessionId)
          setLocationVersion((version) => version + 1);
        break;
    }
    setCategoryVersion((version) => version + 1);
  });
  const categoryFor = (id: string): string | undefined => {
    categoryVersion();
    const child = context.data.session.get(id);
    if (!child || child.parentID !== props.sessionId) return undefined;
    const parts = context.data.session.message
      .list(props.sessionId)
      .flatMap((message) => (message.type === "assistant" ? message.content : []));
    const result = category.resolve(
      { id: child.id, parentID: child.parentID, title: child.title ?? "" },
      parts,
    );
    return result.kind === "resolved" ? result.category : undefined;
  };
  createEffect(() => {
    const sessionId = props.sessionId;
    locationVersion();
    const current = new AbortController();
    const abort = () => current.abort();
    controller.signal.addEventListener("abort", abort, { once: true });
    setState(undefined);
    setDirectory(undefined);
    setColors({});
    reconciler.setActive(false);
    let disposed = false;
    let refreshTimer: ReturnType<typeof setInterval> | undefined;
    let colorTimer: ReturnType<typeof setInterval> | undefined;
    let hadAvailableState = false;
    void readSessionLocation(context.client, sessionId, current.signal)
      .then((location) => {
        if (disposed || !location) return;
        setDirectory(location.directory);
        setBranch(
          context.data.location.vcs.info({ directory: location.directory })?.branch?.current,
        );
        const refresh = () => {
          const next = selectAkaneState(
            readAkaneState(akaneStatePath(location.directory)),
            readAkaneState(akaneStatePath(location.project.directory)),
            sessionId,
            Date.now(),
          );
          setState(next);
          if (next === undefined) {
            hadAvailableState = false;
          } else {
            if (!hadAvailableState) refreshColors(location.directory);
            hadAvailableState = true;
            category.refresh({
              taskDirectory: join(location.directory, ".omo", "senpi-task", "tasks"),
              teamRuntimeDirectory: join(homedir(), ".omo", "runtime"),
            });
            setCategoryVersion((version) => version + 1);
          }
          reconciler.setActive(next !== undefined && registry !== undefined);
        };
        const refreshColors = (selectedDirectory: string) => {
          const palette = theme();
          const nextColors: Record<string, RGBA | undefined> = {};
          for (const agent of context.data.location.agent.list({ directory: selectedDirectory }) ??
            []) {
            if (agent.color) nextColors[agent.name] = agentColor(agent.color, palette);
          }
          setColors(nextColors);
        };
        refresh();
        refreshTimer = setInterval(refresh, 1000);
        colorTimer = setInterval(() => {
          if (state() !== undefined && !current.signal.aborted) refreshColors(location.directory);
        }, 30_000);
      })
      .catch(() => {
        if (!current.signal.aborted)
          consoleSubagentLogger.warn("[subagent] session location unavailable");
      });
    onCleanup(() => {
      disposed = true;
      current.abort();
      controller.signal.removeEventListener("abort", abort);
      if (refreshTimer) clearInterval(refreshTimer);
      if (colorTimer) clearInterval(colorTimer);
      reconciler.setActive(false);
    });
  });
  let stopPromise: Promise<void> | undefined;
  const stop = () => {
    if (stopPromise !== undefined) return stopPromise;
    controller.abort();
    unsubscribe();
    stopPromise = Promise.all([reconciler.stop(), registry?.stop()]).then(() => undefined);
    return stopPromise;
  };
  const unregister = props.registerCleanup(stop);
  onCleanup(() => {
    void stop().finally(unregister);
  });
  return (
    <Show when={state()}>
      {(available) => (
        <box flexDirection="column">
          <AkaneSidebar
            state={available()}
            sessionId={props.sessionId}
            theme={theme()}
            branch={branch()}
            worktree={directory()?.split(/[\\/]/).filter(Boolean).at(-1)}
            now={Date.now()}
            agentColors={colors()}
          />
          <Show when={registry}>
            {(instance) => (
              <SidebarObserver
                registry={instance()}
                config={props.config}
                sessionId={props.sessionId}
                theme={theme()}
                categoryFor={categoryFor}
              />
            )}
          </Show>
        </box>
      )}
    </Show>
  );
}
