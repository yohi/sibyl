import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  akaneStateReady,
  parseAkaneState,
  readAkaneState,
  selectAkaneState,
} from "../src/akane-state.js";

const state = {
  version: 1,
  enabled: true,
  timestamp: 100_000,
  global: { hangupsDetected: 0, pingsSent: 0, recoveries: 0, silencedFailures: 0 },
  sessions: { session: { state: "WATCHING", runningToolsCount: 0, pendingRequestsCount: 0 } },
};

describe("akane state contract", () => {
  test("reads valid files and treats missing or corrupt files as unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "sibyl-akane-"));
    const file = join(dir, "state.json");
    try {
      expect(readAkaneState(file)).toBeUndefined();
      writeFileSync(file, "{");
      expect(readAkaneState(file)).toBeUndefined();
      writeFileSync(file, JSON.stringify(state));
      expect(readAkaneState(file)).toEqual(state);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("rejects malformed and unsupported states", () => {
    expect(parseAkaneState({ ...state, version: 2 })).toBeUndefined();
    expect(parseAkaneState({ ...state, sessions: [] })).toBeUndefined();
    expect(parseAkaneState({ ...state, timestamp: Number.NaN })).toBeUndefined();
    expect(parseAkaneState(state)).toBeDefined();
  });

  test("does not retain unknown fields from shared state", () => {
    const parsed = parseAkaneState({
      ...state,
      secret: "hidden",
      sessions: { session: { ...state.sessions.session, secret: "hidden" } },
    });
    expect(JSON.stringify(parsed)).not.toContain("hidden");
  });

  test("enforces enabled and freshness boundaries", () => {
    const parsed = parseAkaneState(state);
    expect(akaneStateReady(parsed, 190_000)).toBe(true);
    expect(akaneStateReady(parsed, 190_001)).toBe(false);
    expect(akaneStateReady(parsed, 70_000)).toBe(true);
    expect(akaneStateReady(parsed, 69_999)).toBe(false);
    expect(akaneStateReady(parseAkaneState({ ...state, enabled: false }), 100_000)).toBe(false);
  });

  test("prefers an available state containing the current session", () => {
    const matching = parseAkaneState(state);
    const newer = parseAkaneState({ ...state, timestamp: 101_000, sessions: {} });
    expect(selectAkaneState(newer, matching, "session", 101_000)).toEqual(matching);
  });
});
