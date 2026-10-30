import type { SubagentLogger } from "./subagent-logger.js";

export function createObserverReconciler(deps: {
  readonly refresh: () => Promise<void>;
  readonly logger: SubagentLogger;
  readonly setInterval?: typeof setInterval;
  readonly clearInterval?: typeof clearInterval;
}) {
  let active = false;
  let stopped = false;
  let dirty = false;
  let pending: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const refresh = async (): Promise<void> => {
    try {
      await deps.refresh();
    } catch {
      deps.logger.warn("[subagent] reconciliation failed");
    }
  };
  const request = (): void => {
    if (!active || stopped) return;
    if (pending) {
      dirty = true;
      return;
    }
    pending = refresh().finally(() => {
      pending = undefined;
      if (dirty && active && !stopped) {
        dirty = false;
        request();
      }
    });
  };
  return {
    setActive(value: boolean): void {
      if (stopped || value === active) return;
      active = value;
      if (timer) (deps.clearInterval ?? clearInterval)(timer);
      timer = undefined;
      dirty = false;
      if (active) {
        request();
        timer = (deps.setInterval ?? setInterval)(request, 5000);
      }
    },
    request,
    async stop(): Promise<void> {
      stopped = true;
      active = false;
      dirty = false;
      if (timer) (deps.clearInterval ?? clearInterval)(timer);
      timer = undefined;
      await pending;
    },
  };
}
