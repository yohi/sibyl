import { expect, test } from "bun:test";
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { SubagentLogger } from "../src/subagent-logger";
import { SubagentRegistry } from "../src/subagent-registry";
import type { ObserverEventSource } from "../src/subagent-event-source";
import { DEFAULT_OBSERVER_CONFIG, type ObserverConfig } from "../src/subagent-config";
import type { ObserverRegistrySnapshot, SubagentRuntimeView } from "../src/subagent-types";
import type { ObserverSnapshotReader } from "../src/subagent-snapshot-reader";
import { SidebarObserver } from "../src/subagent-observer";

const color = RGBA.fromHex("#ffffff");

const theme = {
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

const logger: SubagentLogger = { info: () => {}, warn: () => {}, error: () => {} };

const source: ObserverEventSource = {
  start: () => {},
  stop: async () => {},
  onEvent: () => () => {},
  onReconnectRequired: () => () => {},
};

const reader: ObserverSnapshotReader = {
  readParent: async (parentSessionId) => ({
    parentSessionId,
    children: [],
    omittedCount: 0,
    ignoredSessionIdsSeen: [],
  }),
  readMessage: async () => ({ parts: [] }),
};

class FakeRegistry extends SubagentRegistry {
  private current: ObserverRegistrySnapshot;
  private readonly listeners = new Set<() => void>();
  readonly selectedParents: string[] = [];

  constructor(snapshot: ObserverRegistrySnapshot) {
    super({ eventSource: source, snapshotReader: reader, config: DEFAULT_OBSERVER_CONFIG, logger });
    this.current = snapshot;
  }

  override snapshot(): ObserverRegistrySnapshot {
    return this.current;
  }

  override subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  override selectParent(parentSessionId: string): Promise<void> {
    this.selectedParents.push(parentSessionId);
    return Promise.resolve();
  }

  update(snapshot: ObserverRegistrySnapshot): void {
    this.current = snapshot;
    for (const listener of this.listeners) listener();
  }
}

function view(overrides: Partial<SubagentRuntimeView> = {}): SubagentRuntimeView {
  return {
    sessionId: "child-1",
    parentSessionId: "root",
    agentName: "explore",
    status: "busy",
    createdAt: 1,
    updatedAt: 2,
    recentActivity: [],
    ...overrides,
  };
}

function config(overrides: Partial<ObserverConfig> = {}): ObserverConfig {
  return { ...DEFAULT_OBSERVER_CONFIG, enabled: true, ...overrides };
}

test("renders status, activity, model, latest text, and public reasoning", async () => {
  const registry = new FakeRegistry({
    parentSessionId: "root",
    ready: true,
    overflowCount: 0,
    views: [
      view({
        providerId: "openai",
        modelId: "gpt-5.6",
        currentActivity: { id: "tool-1", toolName: "read", state: "running", updatedAt: 20 },
        latestAssistantText: "Found the lifecycle implementation.",
        publicReasoningSummary: "Correlating the latest event.",
      }),
    ],
  });
  const setup = await testRender(
    () => <SidebarObserver registry={registry} config={config()} sessionId="root" theme={theme} />,
    { width: 64, height: 14 },
  );

  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("explore");
    expect(frame).toContain("BUSY");
    expect(frame).toContain("openai · gpt-5.6");
    expect(frame).toContain("RUNNING read");
    expect(frame).toContain("Found the lifecycle implementation.");
    expect(frame).toContain("Reasoning: Correlating the latest event.");
  } finally {
    setup.renderer.destroy();
  }
});

test("keeps status and activity while hiding conditional secondary fields", async () => {
  const registry = new FakeRegistry({
    parentSessionId: "root",
    ready: true,
    overflowCount: 0,
    views: [
      view({
        providerId: "openai",
        modelId: "gpt-5.6",
        currentActivity: { id: "tool-1", toolName: "read", state: "running", updatedAt: 20 },
        latestAssistantText: "private latest text",
        publicReasoningSummary: "private summary",
      }),
    ],
  });
  const setup = await testRender(
    () => (
      <SidebarObserver
        registry={registry}
        config={config({
          showModel: false,
          showProvider: false,
          showLatestText: false,
          showReasoningSummary: false,
        })}
        sessionId="root"
        theme={theme}
      />
    ),
    { width: 42, height: 10 },
  );

  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("explore");
    expect(frame).toContain("BUSY");
    expect(frame).toContain("RUNNING read");
    expect(frame).not.toContain("openai");
    expect(frame).not.toContain("gpt-5.6");
    expect(frame).not.toContain("private latest text");
    expect(frame).not.toContain("private summary");
  } finally {
    setup.renderer.destroy();
  }
});

test("selects the active parent and renders one aggregate overflow line", async () => {
  const registry = new FakeRegistry({
    parentSessionId: "root-b",
    ready: true,
    overflowCount: 3,
    views: Array.from({ length: 9 }, (_, index) => view({ sessionId: `child-${index + 1}` })),
  });
  const setup = await testRender(
    () => (
      <SidebarObserver
        registry={registry}
        config={config({ maxVisibleSubagents: 1 })}
        sessionId="root-b"
        theme={theme}
      />
    ),
    { width: 42, height: 10 },
  );

  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(registry.selectedParents).toEqual(["root-b"]);
    expect(frame).toContain("+11 omitted");
  } finally {
    setup.renderer.destroy();
  }
});
