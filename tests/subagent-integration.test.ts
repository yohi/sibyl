import { describe, expect, test } from "bun:test";
import type { TuiPluginApi, TuiSlotPlugin } from "@opencode-ai/plugin/tui";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { DEFAULT_OBSERVER_CONFIG, type ObserverConfig } from "../src/subagent-config";
import type { NormalizedObserverEvent, ObserverEventSource } from "../src/subagent-event-source";
import { attachSubagentIntegration } from "../src/subagent-integration";
import type { SubagentLogger } from "../src/subagent-logger";
import type { ObserverSnapshotReader } from "../src/subagent-snapshot-reader";
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui";

class MemoryObserverEventSource implements ObserverEventSource {
  started = 0;
  stopped = 0;
  private readonly eventHandlers = new Set<(event: NormalizedObserverEvent) => void>();
  private readonly reconnectHandlers = new Set<() => Promise<void> | void>();

  start(): void {
    this.started += 1;
  }

  async stop(): Promise<void> {
    this.stopped += 1;
  }

  onEvent(handler: (event: NormalizedObserverEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onReconnectRequired(handler: () => Promise<void> | void): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  emit(event: NormalizedObserverEvent): void {
    for (const handler of this.eventHandlers) handler(event);
  }

  async reconnect(): Promise<void> {
    for (const handler of this.reconnectHandlers) await handler();
  }
}

const logger: SubagentLogger = { info: () => {}, warn: () => {}, error: () => {} };

function snapshotReader(readParent: ObserverSnapshotReader["readParent"]): ObserverSnapshotReader {
  return {
    readParent,
    readMessage: async () => ({ parts: [] }),
  };
}

function makeApi() {
  const registrations: TuiSlotPlugin[] = [];
  const disposers: Array<() => void | Promise<void>> = [];
  const api = {
    client: {} as TuiPluginApi["client"],
    event: { on: () => () => {} } as TuiPluginApi["event"],
    state: {} as TuiPluginApi["state"],
    theme: { current: testTheme } as TuiPluginApi["theme"],
    slots: {
      register(plugin: TuiSlotPlugin): string {
        registrations.push(plugin);
        return `registration-${registrations.length}`;
      },
    } as TuiPluginApi["slots"],
    lifecycle: {
      signal: new AbortController().signal,
      onDispose(handler: () => void | Promise<void>): () => void {
        disposers.push(handler);
        return () => {};
      },
    },
  } as Pick<TuiPluginApi, "client" | "event" | "state" | "slots" | "theme" | "lifecycle">;
  return { api, registrations, disposers };
}

const color = RGBA.fromHex("#ffffff");
const testTheme = {
  primary: color,
  secondary: color,
  accent: color,
  error: color,
  warning: color,
  success: color,
  info: color,
  text: color,
  textMuted: color,
  selectedListItemText: color,
  background: color,
  backgroundPanel: color,
  backgroundElement: color,
  backgroundMenu: color,
  border: color,
  borderActive: color,
  borderSubtle: color,
  diffAdded: color,
  diffRemoved: color,
  diffContext: color,
  diffHunkHeader: color,
  diffHighlightAdded: color,
  diffHighlightRemoved: color,
  diffAddedBg: color,
  diffRemovedBg: color,
  diffContextBg: color,
  diffLineNumber: color,
  diffAddedLineNumberBg: color,
  diffRemovedLineNumberBg: color,
  markdownText: color,
  markdownHeading: color,
  markdownLink: color,
  markdownLinkText: color,
  markdownCode: color,
  markdownBlockQuote: color,
  markdownEmph: color,
  markdownStrong: color,
  markdownHorizontalRule: color,
  markdownListItem: color,
  markdownListEnumeration: color,
  markdownImage: color,
  markdownImageText: color,
  markdownCodeBlock: color,
  syntaxComment: color,
  syntaxKeyword: color,
  syntaxFunction: color,
  syntaxVariable: color,
  syntaxString: color,
  syntaxNumber: color,
  syntaxType: color,
  syntaxOperator: color,
  syntaxPunctuation: color,
  thinkingOpacity: 0.5,
} satisfies TuiThemeCurrent;

const enabledConfig: ObserverConfig = { ...DEFAULT_OBSERVER_CONFIG, enabled: true };

describe("attachSubagentIntegration", () => {
  test("does not construct or register observer resources when disabled", async () => {
    const source = new MemoryObserverEventSource();
    const { api, registrations, disposers } = makeApi();
    const handle = await attachSubagentIntegration(api, DEFAULT_OBSERVER_CONFIG, {
      eventSource: source,
      snapshotReader: snapshotReader(async (parentSessionId) => ({
        parentSessionId,
        children: [],
        omittedCount: 0,
        ignoredSessionIdsSeen: [],
      })),
      logger,
    });

    expect(handle.enabled).toBe(false);
    expect(handle.registry).toBeUndefined();
    expect(registrations).toHaveLength(0);
    expect(disposers).toHaveLength(0);
    expect(source.started).toBe(0);
  });

  test("registers only sidebar_content and passes the active slot session", async () => {
    const source = new MemoryObserverEventSource();
    const { api, registrations } = makeApi();
    const handle = await attachSubagentIntegration(api, enabledConfig, {
      eventSource: source,
      snapshotReader: snapshotReader(async (parentSessionId) => ({
        parentSessionId,
        children: [],
        omittedCount: 0,
        ignoredSessionIdsSeen: [],
      })),
      logger,
    });

    const registration = registrations[0];
    expect(registrations).toHaveLength(1);
    expect(Object.keys(registration?.slots ?? {})).toEqual(["sidebar_content"]);
    const renderSidebar = registration?.slots.sidebar_content;
    if (renderSidebar === undefined) throw new Error("sidebar_content registration is missing");

    const setup = await testRender(
      () => renderSidebar({ theme: { current: testTheme } }, { session_id: "parent-1" }),
      { width: 42, height: 10 },
    );
    const element = setup.renderer.root.getChildren()[0];
    expect(element).toBeDefined();
    expect(source.started).toBe(1);
    setup.renderer.destroy();
    await handle.stop();
  });

  test("resyncs on source reconnect and stops the registry idempotently", async () => {
    const source = new MemoryObserverEventSource();
    const { api, registrations, disposers } = makeApi();
    let reads = 0;
    const handle = await attachSubagentIntegration(api, enabledConfig, {
      eventSource: source,
      snapshotReader: snapshotReader(async (parentSessionId) => {
        reads += 1;
        return {
          parentSessionId,
          children: [],
          omittedCount: 0,
          ignoredSessionIdsSeen: [],
        };
      }),
      logger,
    });

    const renderSidebar = registrations[0]?.slots.sidebar_content;
    if (renderSidebar === undefined) throw new Error("sidebar_content registration is missing");
    const setup = await testRender(
      () => renderSidebar({ theme: { current: testTheme } }, { session_id: "parent-1" }),
      { width: 42, height: 10 },
    );
    await handle.registry?.selectParent("parent-1");
    const readsAfterSelection = reads;
    await source.reconnect();
    expect(reads).toBe(readsAfterSelection + 1);

    const dispose = disposers[0];
    if (dispose === undefined) throw new Error("lifecycle disposer is missing");
    await dispose();
    await dispose();
    expect(source.stopped).toBe(1);
    await handle.stop();
    setup.renderer.destroy();
  });
});
