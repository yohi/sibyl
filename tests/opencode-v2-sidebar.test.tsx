import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RGBA } from "@opentui/core";
import type { OpenCodeEvent } from "@opencode/client";
import { testRender } from "@opentui/solid";
import { DEFAULT_OBSERVER_CONFIG } from "../src/subagent-config";
import { SidebarV2 } from "../src/sidebar-v2";
import { makeSession } from "./helpers/opencode-v2";

test("renders Akane status only for the selected session location", async () => {
  const directory = mkdtempSync(join(tmpdir(), "sibyl-v2-sidebar-"));
  mkdirSync(join(directory, ".akane"));
  writeFileSync(
    join(directory, ".akane", "watchdog-state.json"),
    JSON.stringify({
      version: 1,
      enabled: true,
      timestamp: Date.now(),
      global: { hangupsDetected: 0, pingsSent: 0, recoveries: 0, silencedFailures: 0 },
      sessions: {},
    }),
  );
  const color = RGBA.fromHex("#ffffff");
  let agentLists = 0;
  let selectedDirectory = directory;
  const requestedDirectories: string[] = [];
  const listeners: Array<(event: { readonly details: OpenCodeEvent }) => void> = [];
  const context = {
    client: {
      session: { get: async () => makeSession({ location: { directory: selectedDirectory } }) },
      location: {
        get: async () => {
          requestedDirectories.push(selectedDirectory);
          return {
            directory: selectedDirectory,
            project: {
              id: "project_test",
              directory: selectedDirectory,
              canonical: selectedDirectory,
            },
          };
        },
      },
    },
    data: {
      listen: (handler: (event: { readonly details: OpenCodeEvent }) => void) => {
        listeners.push(handler);
        return () => {};
      },
      location: {
        vcs: { info: () => undefined },
        agent: {
          list: () => {
            agentLists += 1;
            return [];
          },
        },
      },
    },
    theme: {
      hue: { accent: { 500: color } },
      text: {
        base: color,
        muted: color,
        action: { primary: { base: color }, secondary: { base: color } },
        feedback: {
          error: { base: color },
          warning: { base: color },
          success: { base: color },
          info: { base: color },
        },
      },
      background: { raised: { base: color } },
    },
  };
  const setup = await testRender(
    () =>
      Reflect.apply(SidebarV2, undefined, [
        {
          context,
          config: DEFAULT_OBSERVER_CONFIG,
          sessionId: "ses_child",
          registerCleanup: () => () => {},
        },
      ]),
    { width: 50, height: 20 },
  );
  try {
    await Bun.sleep(1100);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Akane Watchdog");
    expect(agentLists).toBe(1);
    const movedDirectory = join(directory, "worktree");
    mkdirSync(join(movedDirectory, ".akane"), { recursive: true });
    writeFileSync(
      join(movedDirectory, ".akane", "watchdog-state.json"),
      JSON.stringify({
        version: 1,
        enabled: true,
        timestamp: Date.now(),
        global: { hangupsDetected: 0, pingsSent: 0, recoveries: 0, silencedFailures: 0 },
        sessions: {},
      }),
    );
    selectedDirectory = movedDirectory;
    const moved: OpenCodeEvent = {
      id: "evt_move",
      created: Date.now(),
      type: "session.moved",
      durable: { aggregateID: "ses_child", seq: 1, version: 1 },
      data: {
        sessionID: "ses_child",
        location: { directory: movedDirectory },
        projectID: "project_test",
      },
    };
    for (const listener of listeners) listener({ details: moved });
    await Bun.sleep(10);
    await setup.renderOnce();
    expect(requestedDirectories.at(-1)).toBe(movedDirectory);
  } finally {
    setup.renderer.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("repeated plugin cleanup releases the listener once", async () => {
  let released = 0;
  let cleanup: (() => Promise<void>) | undefined;
  const context = {
    client: {
      session: {
        get: async () => {
          throw new Error("not found");
        },
      },
    },
    data: {
      listen: () => () => {
        released += 1;
      },
    },
  };
  const setup = await testRender(
    () =>
      Reflect.apply(SidebarV2, undefined, [
        {
          context,
          config: DEFAULT_OBSERVER_CONFIG,
          sessionId: "ses_missing",
          registerCleanup: (callback: () => Promise<void>) => {
            cleanup = callback;
            return () => {};
          },
        },
      ]),
    { width: 50, height: 20 },
  );
  try {
    await cleanup?.();
    await cleanup?.();
    expect(released).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});
