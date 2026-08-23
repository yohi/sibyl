import type { ObserverConfig } from "./subagent-config.js";
import type { NormalizedObserverEvent, ObserverEventSource } from "./subagent-event-source.js";
import type { SubagentLogger } from "./subagent-logger.js";
import { MESSAGE_REFERENCE_LIMIT, PART_REFERENCE_LIMIT } from "./subagent-snapshot-reader.js";
import type {
  HydratedSubagent,
  ObserverParentSnapshot,
  ObserverSnapshotReader,
} from "./subagent-snapshot-reader.js";
import type {
  ObserverRegistrySnapshot,
  ObserverRuntimeStatus,
  ObserverToolActivity,
  SafeMessageProjection,
  SafePartProjection,
  SafeSessionProjection,
  SubagentRuntimeView,
} from "./subagent-types.js";

const PENDING_EVENT_LIMIT = MESSAGE_REFERENCE_LIMIT + PART_REFERENCE_LIMIT + 8;
const STATUS_URGENCY: Record<ObserverRuntimeStatus, number> = {
  error: 0,
  retry: 1,
  busy: 2,
  idle: 3,
  unknown: 4,
};

type RegistryTimer = ReturnType<typeof setTimeout>;

export interface SubagentRegistryDependencies {
  readonly eventSource: ObserverEventSource;
  readonly snapshotReader: ObserverSnapshotReader;
  readonly config: ObserverConfig;
  readonly logger: SubagentLogger;
  readonly now?: () => number;
  readonly queueMicrotask?: (callback: () => void) => void;
  readonly setTimer?: (callback: () => void, delayMs: number) => RegistryTimer;
  readonly clearTimer?: (timer: RegistryTimer) => void;
}

interface TrackedChild {
  session: SafeSessionProjection;
  status: ObserverRuntimeStatus;
  messages: Map<string, SafeMessageProjection>;
  parts: Map<string, SafePartProjection>;
  updatedAt: number;
  lastSequence: number;
  messageError: boolean;
  retentionDeadline: number | undefined;
  retentionTimer: RegistryTimer | undefined;
}

interface PendingChild {
  readonly events: Map<string, NormalizedObserverEvent>;
}

interface RefreshRequest {
  readonly messageId: string;
  readonly sequence: number;
}

interface RefreshState {
  readonly generation: number;
  controller: AbortController;
  request: RefreshRequest;
  pending: RefreshRequest | undefined;
}

function saturatingAdd(left: number, right: number): number {
  if (!Number.isFinite(right) || right <= 0) return Math.max(0, left);
  return Math.min(Number.MAX_SAFE_INTEGER, left + Math.floor(right));
}

function boundedCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

function eventSessionId(event: NormalizedObserverEvent): string {
  switch (event.type) {
    case "session.upsert":
      return event.session.id;
    case "session.deleted":
    case "status.changed":
    case "session.idle":
    case "session.error":
    case "session.retry":
    case "message.removed":
    case "part.refresh":
    case "part.removed":
      return event.sessionId;
    case "message.upsert":
      return event.message.sessionId;
    case "part.upsert":
      return event.part.sessionId;
  }
}

function eventKey(event: NormalizedObserverEvent): string {
  switch (event.type) {
    case "session.upsert":
    case "session.deleted":
      return "session";
    case "status.changed":
    case "session.idle":
    case "session.error":
    case "session.retry":
      return "status";
    case "message.upsert":
      return `message:${event.message.id}`;
    case "message.removed":
      return `message:${event.messageId}`;
    case "part.upsert":
      return `part:${event.part.partId}`;
    case "part.refresh":
    case "part.removed":
      return `part:${event.partId}`;
  }
}

function compareNewest(
  leftTime: number,
  leftId: string,
  rightTime: number,
  rightId: string,
): number {
  return rightTime - leftTime || leftId.localeCompare(rightId);
}

function newerMessage(
  messages: Iterable<SafeMessageProjection>,
  role: "user" | "assistant",
): SafeMessageProjection | undefined {
  let newest: SafeMessageProjection | undefined;
  for (const message of messages) {
    if (message.role !== role) continue;
    if (
      newest === undefined ||
      compareNewest(message.createdAt, message.id, newest.createdAt, newest.id) < 0
    ) {
      newest = message;
    }
  }
  return newest;
}

function newestAssistantWithModel(
  messages: Iterable<SafeMessageProjection>,
): { readonly providerId: string; readonly modelId: string } | undefined {
  let newest: SafeMessageProjection | undefined;
  for (const message of messages) {
    if (
      message.role !== "assistant" ||
      message.providerId === undefined ||
      message.modelId === undefined
    ) {
      continue;
    }
    if (
      newest === undefined ||
      compareNewest(message.createdAt, message.id, newest.createdAt, newest.id) < 0
    ) {
      newest = message;
    }
  }
  return newest?.providerId === undefined || newest.modelId === undefined
    ? undefined
    : { providerId: newest.providerId, modelId: newest.modelId };
}

function newestUserWithModel(
  messages: Iterable<SafeMessageProjection>,
): { readonly providerId: string; readonly modelId: string } | undefined {
  let newest: SafeMessageProjection | undefined;
  for (const message of messages) {
    if (
      message.role !== "user" ||
      message.providerId === undefined ||
      message.modelId === undefined
    ) {
      continue;
    }
    if (
      newest === undefined ||
      compareNewest(message.createdAt, message.id, newest.createdAt, newest.id) < 0
    ) {
      newest = message;
    }
  }
  return newest?.providerId === undefined || newest.modelId === undefined
    ? undefined
    : { providerId: newest.providerId, modelId: newest.modelId };
}

function isToolPart(
  part: SafePartProjection,
): part is Extract<SafePartProjection, { readonly kind: "tool" }> {
  return part.kind === "tool";
}

function isAgentPart(
  part: SafePartProjection,
): part is Extract<SafePartProjection, { readonly kind: "agent" }> {
  return part.kind === "agent";
}

function isSubtaskPart(
  part: SafePartProjection,
): part is Extract<SafePartProjection, { readonly kind: "subtask" }> {
  return part.kind === "subtask";
}

function isAssistantTextPart(
  part: SafePartProjection,
): part is Extract<SafePartProjection, { readonly kind: "assistant-text" }> {
  return part.kind === "assistant-text";
}

function isReasoningSummaryPart(
  part: SafePartProjection,
): part is Extract<SafePartProjection, { readonly kind: "public-reasoning-summary" }> {
  return part.kind === "public-reasoning-summary";
}

function partObservedAt(part: SafePartProjection): number {
  return isToolPart(part) ? part.activity.updatedAt : part.observedAt;
}

function newestPart<T extends SafePartProjection>(
  parts: Iterable<SafePartProjection>,
  predicate: (part: SafePartProjection) => part is T,
): T | undefined {
  let newest: T | undefined;
  for (const part of parts) {
    if (!predicate(part)) continue;
    const observedAt = partObservedAt(part);
    const newestObservedAt = newest === undefined ? undefined : partObservedAt(newest);
    if (
      newest === undefined ||
      (newestObservedAt !== undefined &&
        compareNewest(observedAt, part.partId, newestObservedAt, newest.partId) < 0)
    ) {
      newest = part;
    }
  }
  return newest;
}

function newestActivity(
  activities: readonly ObserverToolActivity[],
  states: readonly ObserverToolActivity["state"][],
): ObserverToolActivity | undefined {
  const candidates = activities
    .filter((activity) => states.includes(activity.state))
    .sort(
      (left, right) =>
        (left.state === "running" ? 0 : 1) - (right.state === "running" ? 0 : 1) ||
        compareNewest(left.updatedAt, left.id, right.updatedAt, right.id),
    );
  return candidates[0];
}

function toRuntimeView(child: TrackedChild, activityLimit: number): SubagentRuntimeView {
  const agentPart = newestPart(
    child.parts.values(),
    (part): part is Extract<SafePartProjection, { readonly kind: "agent" }> =>
      isAgentPart(part) && part.name !== "unknown",
  );
  const subtaskPart = newestPart(
    child.parts.values(),
    (part): part is Extract<SafePartProjection, { readonly kind: "subtask" }> =>
      isSubtaskPart(part) && part.agent !== "unknown",
  );
  const userMessage = newerUserMessage(child.messages.values());
  const agentName = agentPart?.name ?? subtaskPart?.agent ?? userMessage?.agentName ?? "unknown";
  const model =
    newestAssistantWithModel(child.messages.values()) ??
    newestUserWithModel(child.messages.values());

  const tools = [...child.parts.values()].filter(isToolPart).map((part) => part.activity);
  const currentActivity = newestActivity(tools, ["running", "pending"]);
  const recentActivity = tools
    .filter((activity) => activity.state === "completed" || activity.state === "error")
    .sort((left, right) => compareNewest(left.updatedAt, left.id, right.updatedAt, right.id))
    .slice(0, activityLimit);
  const latestText = newestPart(child.parts.values(), isAssistantTextPart);
  const reasoningSummary = newestPart(child.parts.values(), isReasoningSummaryPart);

  return {
    sessionId: child.session.id,
    parentSessionId: child.session.parentSessionId ?? "",
    agentName,
    ...(model === undefined ? {} : model),
    status: child.status,
    createdAt: child.session.createdAt,
    updatedAt: child.updatedAt,
    ...(currentActivity === undefined ? {} : { currentActivity }),
    recentActivity,
    ...(latestText === undefined ? {} : { latestAssistantText: latestText.text }),
    ...(reasoningSummary === undefined ? {} : { publicReasoningSummary: reasoningSummary.text }),
  };
}

function newerUserMessage(
  messages: Iterable<SafeMessageProjection>,
): Extract<SafeMessageProjection, { readonly role: "user" }> | undefined {
  const message = newerMessage(messages, "user");
  return message?.role === "user" ? message : undefined;
}

function hasAssistantError(messages: Iterable<SafeMessageProjection>): boolean {
  for (const message of messages) {
    if (message.role === "assistant" && message.hasError) return true;
  }
  return false;
}

function createTrackedChild(child: HydratedSubagent): TrackedChild {
  const messages = new Map<string, SafeMessageProjection>();
  for (const message of child.messages) messages.set(message.id, message);
  const parts = new Map<string, SafePartProjection>();
  for (const part of child.parts) parts.set(part.partId, part);
  return {
    session: child.session,
    status: hasAssistantError(messages.values()) ? "error" : child.status,
    messages,
    parts,
    updatedAt: child.session.updatedAt,
    lastSequence: 0,
    messageError: hasAssistantError(messages.values()),
    retentionDeadline: undefined,
    retentionTimer: undefined,
  };
}

export class SubagentRegistry {
  private readonly tracked = new Map<string, TrackedChild>();
  private readonly pending = new Map<string, PendingChild>();
  private readonly omittedIds = new Set<string>();
  private readonly tombstones = new Set<string>();
  private readonly refreshes = new Map<string, RefreshState>();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly queueMicrotask: (callback: () => void) => void;
  private started = false;
  private stopped = false;
  private ready = false;
  private parentSessionId: string | undefined;
  private overflowCount = 0;
  private selectionGeneration = 0;
  private lastSequenceSeen = 0;
  private readController: AbortController | undefined;
  private readInFlight = false;
  private resyncPromise: Promise<void> | undefined;
  private resyncRequested = false;
  private resyncAfterRead = false;
  private notificationScheduled = false;
  private offEvent: (() => void) | undefined;
  private offReconnect: (() => void) | undefined;

  constructor(private readonly deps: SubagentRegistryDependencies) {
    this.now = deps.now ?? Date.now;
    this.queueMicrotask = deps.queueMicrotask ?? globalThis.queueMicrotask;
  }

  async selectParent(parentSessionId: string): Promise<void> {
    if (this.stopped) return;

    const generation = this.selectionGeneration + 1;
    this.selectionGeneration = generation;
    this.abortRead();
    this.abortRefreshes();
    this.clearTracked();
    this.pending.clear();
    this.omittedIds.clear();
    this.tombstones.clear();
    this.overflowCount = 0;
    this.parentSessionId = parentSessionId;
    this.ready = false;
    this.resyncRequested = false;
    this.resyncAfterRead = false;
    this.notifySubscribers();

    this.ensureSourceStarted();
    const controller = new AbortController();
    this.readController = controller;
    this.readInFlight = true;

    try {
      const snapshot = await this.deps.snapshotReader.readParent(
        parentSessionId,
        this.deps.config,
        controller.signal,
        new Set(),
      );
      if (this.isStaleRead(generation, controller)) return;
      this.readInFlight = false;
      this.applySnapshot(snapshot);
      this.replayPendingEvents(0);
      this.ready = true;
      this.notifySubscribers();
    } catch (error) {
      if (this.isStaleRead(generation, controller)) return;
      if (error instanceof Error || error instanceof DOMException) {
        if (isAbortError(error)) return;
      }
      this.readInFlight = false;
      this.clearTracked();
      this.overflowCount = 0;
      this.replayPendingEvents(0);
      this.ready = true;
      this.deps.logger.warn("[subagent] snapshot read failed");
      this.notifySubscribers();
    } finally {
      if (this.readController === controller) this.readController = undefined;
    }

    if (this.resyncAfterRead && this.ready && this.parentSessionId === parentSessionId) {
      this.resyncAfterRead = false;
      await this.resyncNow();
    }
  }

  snapshot(): ObserverRegistrySnapshot {
    const views = [...this.tracked.values()]
      .map((child) => toRuntimeView(child, this.deps.config.activityLimit))
      .sort(
        (left, right) =>
          STATUS_URGENCY[left.status] - STATUS_URGENCY[right.status] ||
          right.updatedAt - left.updatedAt ||
          left.sessionId.localeCompare(right.sessionId),
      );
    return {
      ...(this.parentSessionId === undefined ? {} : { parentSessionId: this.parentSessionId }),
      ready: this.ready,
      views,
      overflowCount: this.overflowCount,
    };
  }

  subscribe(listener: () => void): () => void {
    if (this.stopped) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async resyncNow(): Promise<void> {
    if (this.stopped || this.parentSessionId === undefined || !this.ready) {
      if (this.readInFlight) this.resyncAfterRead = true;
      return;
    }
    if (this.resyncPromise !== undefined) {
      this.resyncRequested = true;
      await this.resyncPromise;
      return;
    }

    const promise = this.runResyncLoop();
    this.resyncPromise = promise;
    try {
      await promise;
    } finally {
      if (this.resyncPromise === promise) this.resyncPromise = undefined;
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.selectionGeneration += 1;
    this.abortRead();
    this.abortRefreshes();
    this.clearTracked();
    this.pending.clear();
    this.omittedIds.clear();
    this.tombstones.clear();
    this.parentSessionId = undefined;
    this.ready = false;
    this.overflowCount = 0;
    this.offEvent?.();
    this.offReconnect?.();
    this.offEvent = undefined;
    this.offReconnect = undefined;
    if (this.started) await this.deps.eventSource.stop();
    this.started = false;
  }

  debugCounts(): {
    readonly trackedChildren: number;
    readonly pendingChildren: number;
    readonly messageReferences: number;
    readonly partReferences: number;
    readonly inFlightRefreshes: number;
  } {
    let messageReferences = 0;
    let partReferences = 0;
    for (const child of this.tracked.values()) {
      messageReferences += child.messages.size;
      partReferences += child.parts.size;
    }
    return {
      trackedChildren: this.tracked.size,
      pendingChildren: this.pending.size,
      messageReferences,
      partReferences,
      inFlightRefreshes: this.refreshes.size,
    };
  }

  private ensureSourceStarted(): void {
    if (this.started) return;
    this.started = true;
    this.offEvent = this.deps.eventSource.onEvent((event) => this.receive(event));
    this.offReconnect = this.deps.eventSource.onReconnectRequired(() => this.resyncNow());
    this.deps.eventSource.start();
  }

  private receive(event: NormalizedObserverEvent): void {
    if (this.stopped) return;
    this.lastSequenceSeen = Math.max(this.lastSequenceSeen, event.sequence);
    if (this.parentSessionId === undefined) return;
    if (this.readInFlight) {
      this.bufferEvent(event);
      return;
    }
    this.applyEvent(event, false);
    this.notifySubscribers();
  }

  private bufferEvent(event: NormalizedObserverEvent): void {
    const sessionId = eventSessionId(event);
    let bucket = this.pending.get(sessionId);
    if (bucket === undefined) {
      if (this.pending.size >= this.deps.config.maxTrackedSubagents) return;
      bucket = { events: new Map() };
      this.pending.set(sessionId, bucket);
    }
    const key = eventKey(event);
    const existing = bucket.events.get(key);
    if (existing === undefined || existing.sequence <= event.sequence) {
      bucket.events.set(key, event);
    }
    while (bucket.events.size > PENDING_EVENT_LIMIT) {
      const oldest = [...bucket.events.entries()].sort(
        (left, right) => left[1].sequence - right[1].sequence,
      )[0];
      if (oldest === undefined) break;
      bucket.events.delete(oldest[0]);
    }
  }

  private async runResyncLoop(): Promise<void> {
    do {
      this.resyncRequested = false;
      await this.performResync();
    } while (
      this.resyncRequested &&
      !this.stopped &&
      this.parentSessionId !== undefined &&
      this.ready
    );
  }

  private async performResync(): Promise<void> {
    const parentSessionId = this.parentSessionId;
    if (parentSessionId === undefined || this.stopped || !this.ready) return;
    const generation = this.selectionGeneration;
    const watermark = this.lastSequenceSeen;
    const controller = new AbortController();
    this.abortRead();
    this.readController = controller;
    this.readInFlight = true;
    this.pending.clear();

    try {
      const snapshot = await this.deps.snapshotReader.readParent(
        parentSessionId,
        this.deps.config,
        controller.signal,
        new Set(this.tombstones),
      );
      if (this.isStaleRead(generation, controller)) return;
      this.readInFlight = false;
      const events = this.pendingEventsAfter(watermark);
      this.applyResyncSnapshot(snapshot);
      this.pending.clear();
      for (const event of events) this.applyEvent(event, false);
      this.notifySubscribers();
    } catch (error) {
      if (this.isStaleRead(generation, controller)) return;
      if (error instanceof Error || error instanceof DOMException) {
        if (isAbortError(error)) return;
      }
      this.readInFlight = false;
      const events = this.pendingEventsAfter(watermark);
      this.pending.clear();
      for (const event of events) this.applyEvent(event, false);
      this.deps.logger.warn("[subagent] snapshot resync failed");
      this.notifySubscribers();
    } finally {
      if (this.readController === controller) this.readController = undefined;
    }
  }

  private pendingEventsAfter(watermark: number): readonly NormalizedObserverEvent[] {
    return [...this.pending.values()]
      .flatMap((bucket) => [...bucket.events.values()])
      .filter((event) => event.sequence > watermark)
      .sort((left, right) => left.sequence - right.sequence);
  }

  private replayPendingEvents(watermark: number): void {
    const events = this.pendingEventsAfter(watermark);
    this.pending.clear();
    for (const event of events) this.applyEvent(event, false);
  }

  private applySnapshot(snapshot: ObserverParentSnapshot): void {
    this.clearTracked();
    const parentSessionId = this.parentSessionId;
    if (parentSessionId === undefined) return;
    let selected = 0;
    for (const child of snapshot.children) {
      if (selected >= this.deps.config.maxTrackedSubagents) break;
      if (
        child.session.parentSessionId !== parentSessionId ||
        this.tombstones.has(child.session.id)
      ) {
        continue;
      }
      this.tracked.set(child.session.id, createTrackedChild(child));
      selected += 1;
    }
    const extraChildren = Math.max(0, snapshot.children.length - selected);
    this.overflowCount = saturatingAdd(boundedCount(snapshot.omittedCount), extraChildren);
  }

  private applyResyncSnapshot(snapshot: ObserverParentSnapshot): void {
    const seen = new Set(snapshot.ignoredSessionIdsSeen);
    for (const id of [...this.tombstones]) {
      if (!seen.has(id)) this.tombstones.delete(id);
    }
    this.applySnapshot(snapshot);
    this.omittedIds.clear();
  }

  private applyEvent(event: NormalizedObserverEvent, suppressResync: boolean): void {
    const parentSessionId = this.parentSessionId;
    if (parentSessionId === undefined) return;
    const sessionId = eventSessionId(event);

    if (event.type === "session.upsert") {
      if (event.session.parentSessionId !== parentSessionId || this.tombstones.has(sessionId))
        return;
      const existing = this.tracked.get(sessionId);
      if (existing !== undefined) {
        if (event.sequence < existing.lastSequence) return;
        existing.session = event.session;
        existing.updatedAt = Math.max(
          existing.updatedAt,
          event.observedAt,
          event.session.updatedAt,
        );
        existing.lastSequence = event.sequence;
        return;
      }
      const admitted = this.admitChild(event.session, "unknown", event.observedAt);
      if (admitted !== undefined) {
        admitted.lastSequence = event.sequence;
      }
      return;
    }

    if (event.type === "session.deleted") {
      const wasTracked = this.tracked.has(sessionId);
      this.removeTracked(sessionId);
      this.pending.delete(sessionId);
      this.removeOmitted(sessionId);
      this.addTombstone(sessionId);
      if ((wasTracked || this.tombstones.has(sessionId)) && !suppressResync) {
        void this.resyncNow();
      }
      return;
    }

    const child = this.tracked.get(sessionId);
    if (child === undefined || event.sequence < child.lastSequence) return;
    child.lastSequence = event.sequence;
    child.updatedAt = Math.max(child.updatedAt, event.observedAt);

    switch (event.type) {
      case "status.changed":
        this.applyStatus(child, event.status, event.observedAt);
        break;
      case "session.idle":
        this.applyStatus(child, "idle", event.observedAt);
        break;
      case "session.error":
        this.applyStatus(child, "error", event.observedAt);
        break;
      case "session.retry":
        this.applyStatus(child, "retry", event.observedAt);
        break;
      case "message.upsert":
        if (event.message.sessionId !== sessionId) return;
        child.messages.set(event.message.id, event.message);
        if (event.message.role === "assistant" && event.message.hasError) {
          child.messageError = true;
          this.applyStatus(child, "error", event.observedAt);
        }
        break;
      case "message.removed":
        this.removeMessage(child, event.messageId);
        child.messageError = hasAssistantError(child.messages.values());
        break;
      case "part.upsert":
        if (event.part.sessionId !== sessionId) return;
        child.parts.set(event.part.partId, event.part);
        break;
      case "part.removed":
        this.removePart(child, event.partId, event.messageId);
        break;
      case "part.refresh":
        this.queueRefresh(sessionId, event.messageId, event.sequence);
        break;
    }
  }

  private applyStatus(
    child: TrackedChild,
    status: ObserverRuntimeStatus,
    observedAt: number,
  ): void {
    child.status = status;
    child.messageError = status === "error" ? child.messageError : false;
    if (status === "idle") {
      if (this.deps.config.idleRetentionMs === 0) {
        this.removeTracked(child.session.id);
        void this.resyncNow();
        return;
      }
      this.scheduleRetention(child, observedAt);
      return;
    }
    this.clearRetention(child);
  }

  private admitChild(
    session: SafeSessionProjection,
    status: ObserverRuntimeStatus,
    observedAt: number,
  ): TrackedChild | undefined {
    if (this.tombstones.has(session.id)) return undefined;
    const existing = this.tracked.get(session.id);
    if (existing !== undefined) return existing;
    if (this.tracked.size >= this.deps.config.maxTrackedSubagents) {
      const evictable = [...this.tracked.entries()]
        .filter(([, child]) => child.status === "idle" && child.retentionDeadline !== undefined)
        .filter(([, child]) => (child.retentionDeadline ?? Number.MAX_SAFE_INTEGER) <= this.now())
        .sort(
          (left, right) =>
            (left[1].retentionDeadline ?? Number.MAX_SAFE_INTEGER) -
              (right[1].retentionDeadline ?? Number.MAX_SAFE_INTEGER) ||
            left[0].localeCompare(right[0]),
        )[0];
      if (evictable !== undefined) {
        this.removeTracked(evictable[0]);
      } else {
        this.markOmitted(session.id);
        return undefined;
      }
    }

    const child: TrackedChild = {
      session,
      status,
      messages: new Map(),
      parts: new Map(),
      updatedAt: Math.max(session.updatedAt, observedAt),
      lastSequence: 0,
      messageError: false,
      retentionDeadline: undefined,
      retentionTimer: undefined,
    };
    this.tracked.set(session.id, child);
    return child;
  }

  private markOmitted(sessionId: string): void {
    if (this.omittedIds.has(sessionId) || this.tombstones.has(sessionId)) return;
    if (this.omittedIds.size < this.deps.config.maxTrackedSubagents) {
      this.omittedIds.add(sessionId);
    }
    this.overflowCount = saturatingAdd(this.overflowCount, 1);
  }

  private removeOmitted(sessionId: string): void {
    if (!this.omittedIds.delete(sessionId)) return;
    if (this.overflowCount < Number.MAX_SAFE_INTEGER) {
      this.overflowCount = Math.max(0, this.overflowCount - 1);
    }
  }

  private addTombstone(sessionId: string): void {
    if (this.tombstones.has(sessionId)) return;
    while (this.tombstones.size >= this.deps.config.maxTrackedSubagents) {
      const oldest = this.tombstones.values().next().value;
      if (typeof oldest !== "string") break;
      this.tombstones.delete(oldest);
    }
    this.tombstones.add(sessionId);
  }

  private removeTracked(sessionId: string): void {
    const child = this.tracked.get(sessionId);
    if (child === undefined) return;
    this.clearRetention(child);
    this.abortRefresh(sessionId);
    this.tracked.delete(sessionId);
  }

  private clearTracked(): void {
    for (const child of this.tracked.values()) this.clearRetention(child);
    this.tracked.clear();
  }

  private removeMessage(child: TrackedChild, messageId: string): void {
    child.messages.delete(messageId);
    for (const [partId, part] of child.parts) {
      if (part.messageId === messageId) child.parts.delete(partId);
    }
  }

  private removePart(child: TrackedChild, partId: string, messageId: string): void {
    const part = child.parts.get(partId);
    if (part !== undefined && part.messageId === messageId) child.parts.delete(partId);
  }

  private scheduleRetention(child: TrackedChild, observedAt: number): void {
    this.clearRetention(child);
    const deadline = Math.max(this.now(), observedAt) + this.deps.config.idleRetentionMs;
    child.retentionDeadline = deadline;
    child.retentionTimer = this.scheduleTimer(
      () => {
        if (child.retentionDeadline !== deadline || child.status !== "idle") return;
        this.removeTracked(child.session.id);
        void this.resyncNow();
        this.notifySubscribers();
      },
      Math.max(0, deadline - this.now()),
    );
  }

  private clearRetention(child: TrackedChild): void {
    const timer = child.retentionTimer;
    if (timer !== undefined) this.clearTimer(timer);
    child.retentionTimer = undefined;
    child.retentionDeadline = undefined;
  }

  private queueRefresh(sessionId: string, messageId: string, sequence: number): void {
    const current = this.refreshes.get(sessionId);
    const request = { messageId, sequence } satisfies RefreshRequest;
    if (current !== undefined) {
      if (current.pending === undefined || current.pending.sequence <= sequence) {
        current.pending = request;
      }
      return;
    }
    const state: RefreshState = {
      generation: this.selectionGeneration,
      controller: new AbortController(),
      request,
      pending: undefined,
    };
    this.refreshes.set(sessionId, state);
    void this.runRefresh(sessionId, state);
  }

  private async runRefresh(sessionId: string, state: RefreshState): Promise<void> {
    try {
      const result = await this.deps.snapshotReader.readMessage(
        sessionId,
        state.request.messageId,
        state.controller.signal,
      );
      if (
        !this.stopped &&
        this.selectionGeneration === state.generation &&
        this.parentSessionId !== undefined &&
        this.tracked.has(sessionId)
      ) {
        this.replaceMessage(
          this.tracked.get(sessionId),
          state.request.messageId,
          result.message,
          result.parts,
        );
        this.notifySubscribers();
      }
    } catch (error) {
      if (error instanceof Error || error instanceof DOMException) {
        if (!isAbortError(error) && !this.stopped) {
          this.deps.logger.warn("[subagent] message refresh failed");
        }
      } else if (!this.stopped) {
        this.deps.logger.warn("[subagent] message refresh failed");
      }
    }

    if (this.refreshes.get(sessionId) !== state) return;
    if (state.pending !== undefined && !this.stopped) {
      state.request = state.pending;
      state.pending = undefined;
      state.controller = new AbortController();
      void this.runRefresh(sessionId, state);
      return;
    }
    this.refreshes.delete(sessionId);
  }

  private replaceMessage(
    child: TrackedChild | undefined,
    messageId: string,
    message: SafeMessageProjection | undefined,
    parts: readonly SafePartProjection[],
  ): void {
    if (child === undefined) return;
    this.removeMessage(child, messageId);
    if (
      message !== undefined &&
      message.id === messageId &&
      message.sessionId === child.session.id
    ) {
      child.messages.set(message.id, message);
      child.messageError = message.role === "assistant" && message.hasError;
      if (child.messageError) child.status = "error";
    }
    for (const part of parts) {
      if (part.sessionId === child.session.id && part.messageId === messageId) {
        child.parts.set(part.partId, part);
      }
    }
    child.updatedAt = Math.max(
      child.updatedAt,
      message?.createdAt ?? 0,
      ...parts.map((part) => (part.kind === "tool" ? part.activity.updatedAt : part.observedAt)),
    );
  }

  private abortRefresh(sessionId: string): void {
    const refresh = this.refreshes.get(sessionId);
    if (refresh === undefined) return;
    refresh.controller.abort();
    refresh.pending = undefined;
    this.refreshes.delete(sessionId);
  }

  private abortRefreshes(): void {
    for (const refresh of this.refreshes.values()) refresh.controller.abort();
    this.refreshes.clear();
  }

  private abortRead(): void {
    this.readController?.abort();
    this.readController = undefined;
    this.readInFlight = false;
  }

  private isStaleRead(generation: number, controller: AbortController): boolean {
    return (
      this.stopped ||
      generation !== this.selectionGeneration ||
      this.readController !== controller ||
      controller.signal.aborted
    );
  }

  private notifySubscribers(): void {
    if (this.notificationScheduled || this.listeners.size === 0 || this.stopped) return;
    this.notificationScheduled = true;
    this.queueMicrotask(() => {
      this.notificationScheduled = false;
      if (this.stopped) return;
      for (const listener of this.listeners) listener();
    });
  }

  private scheduleTimer(callback: () => void, delayMs: number): RegistryTimer {
    return this.deps.setTimer?.(callback, delayMs) ?? setTimeout(callback, delayMs);
  }

  private clearTimer(timer: RegistryTimer): void {
    if (this.deps.clearTimer !== undefined) {
      this.deps.clearTimer(timer);
      return;
    }
    clearTimeout(timer);
  }
}
