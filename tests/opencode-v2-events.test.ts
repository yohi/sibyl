import { expect, test } from "bun:test";
import { normalizeV2ObserverEvent, V2EventSource } from "../src/subagent-v2-events";
import type { OpenCodeEvent } from "@opencode/client";

test("unsubscribes V2 events when stopped", async () => {
  let callback: ((event: { details: OpenCodeEvent }) => void) | undefined;
  const received: string[] = [];
  const source = new V2EventSource({
    listen(handler) {
      callback = handler;
      return () => {
        callback = undefined;
      };
    },
  });
  source.onEvent((event) => received.push(event.type));
  source.start();
  callback?.({
    details: {
      type: "session.status",
      id: "evt_test",
      created: 1,
      data: { sessionID: "ses_child", status: { type: "busy" } },
    },
  });
  await source.stop();
  expect(received).toEqual(["status.changed"]);
  expect(callback).toBeUndefined();
});

test("converts V2 session status using its data envelope", () => {
  const event = {
    type: "session.status",
    data: { sessionID: "ses_child", status: { type: "busy" } },
  };
  expect(normalizeV2ObserverEvent(event, 1, 42)).toEqual({
    type: "status.changed",
    sessionId: "ses_child",
    status: "busy",
    sequence: 1,
    observedAt: 42,
  });
});

test("does not project raw reasoning or tool inputs", () => {
  const event = {
    type: "session.reasoning.delta",
    data: { sessionID: "ses_child", delta: "private" },
  };
  expect(normalizeV2ObserverEvent(event, 1, 42)).toBeUndefined();
});
