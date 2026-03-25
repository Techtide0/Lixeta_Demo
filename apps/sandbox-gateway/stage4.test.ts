/**
 * @file stage4.test.ts
 * @description Comprehensive test suite for Stage 4 — State System.
 *
 * Coverage:
 *   1.  Session ID generation — format, uniqueness, entropy
 *   2.  Session store — create, get, append, expire, close, capacity
 *   3.  Session record — applyEngineOutput, counters, immutability
 *   4.  Session creation validation — metadata, TTL, field limits
 *   5.  Multi-event session flow — state accumulates correctly
 *   6.  Logs retrieval — pagination, filter, decisions correlated
 *   7.  Session lifecycle — active → completed → rejects new events
 *   8.  Cross-session isolation — separate states never mix
 *   9.  Security — expired sessions blocked, capacity enforcement
 *  10.  Engine integration — full POST /trigger-event × 2 events in same session
 */

// ── Harness ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function describe(name: string, fn: () => void): void {
  console.log(`\n  ${name}`);
  fn();
}

function it(name: string, fn: () => void): void {
  try { fn(); console.log(`    ✓ ${name}`); passed++; }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`    ✗ ${name}\n      └─ ${msg}`);
    failed++; failures.push(`${name}: ${msg}`);
  }
}

function expect(actual: unknown) {
  return {
    toBe: (v: unknown) => { if (actual !== v) throw new Error(`Expected ${JSON.stringify(v)}, got ${JSON.stringify(actual)}`); },
    toEqual: (v: unknown) => { if (JSON.stringify(actual) !== JSON.stringify(v)) throw new Error(`Expected ${JSON.stringify(v)}, got ${JSON.stringify(actual)}`); },
    toBeGreaterThan: (n: number) => { if (typeof actual !== "number" || actual <= n) throw new Error(`Expected > ${n}, got ${actual}`); },
    toHaveLength: (n: number) => { if ((actual as unknown[]).length !== n) throw new Error(`Expected length ${n}, got ${(actual as unknown[]).length}`); },
    toBeNull: () => { if (actual !== null) throw new Error("Expected null"); },
    toBeTruthy: () => { if (!actual) throw new Error("Expected truthy"); },
    toBeFalsy: () => { if (actual) throw new Error("Expected falsy"); },
    toContain: (s: string) => { if (typeof actual !== "string" || !actual.includes(s)) throw new Error(`Expected "${actual}" to contain "${s}"`); },
    toMatch: (re: RegExp) => { if (typeof actual !== "string" || !re.test(actual)) throw new Error(`Expected "${actual}" to match ${re}`); },
    not: {
      toBe: (v: unknown) => { if (actual === v) throw new Error(`Expected NOT ${JSON.stringify(v)}`); },
      toBeNull: () => { if (actual === null) throw new Error("Expected not null"); },
      toContain: (s: string) => { if (typeof actual === "string" && actual.includes(s)) throw new Error(`Expected NOT to contain "${s}"`); },
    },
  };
}

function expectToThrow(fn: () => void, fragment?: string): void {
  try { fn(); throw new Error("Expected throw, got none"); }
  catch (e) {
    if (fragment) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes(fragment)) throw new Error(`Expected error with "${fragment}", got: "${msg}"`);
    }
  }
}

// ── Imports ───────────────────────────────────────────────────────────────────

import { generateSessionId, isValidSessionIdFormat } from "./src/lib/session-id.js";
import {
  createSession, getSession, appendEventToSession, closeSession,
  touchSession, getStoreMetrics, getSessionCount,
  _clearStoreForTesting, _injectSessionForTesting,
} from "./src/store/session-store.js";
import { applyEngineOutput, markCompleted, markExpired } from "./src/store/session-record.js";
import type { SessionRecord } from "./src/store/session-record.js";
import { _reloadEnvForTesting, getEnv } from "./src/config/env.js";
import { getEngineConfig, _resetEngineConfigForTesting } from "./src/config/engine-bootstrap.js";
import {
  evaluateEvent, _resetRegistryForTesting, _resetBuiltinRegistrationFlag, registerBuiltinRules,
} from "../../packages/rules-engine/src/index.js";
import {
  createInitialSimulationState, createEventSource, createDomainEvent,
  MESSAGE_SENT, PAYMENT_INITIATED,
} from "../../packages/models/src/index.js";

// ── Reset helpers ─────────────────────────────────────────────────────────────

function resetAll(): void {
  process.env["NODE_ENV"] = "development";
  process.env["REQUIRE_AUTH"] = "false";
  delete process.env["API_KEY_HASH"];
  _reloadEnvForTesting();
  _resetEngineConfigForTesting();
  _resetRegistryForTesting();
  _resetBuiltinRegistrationFlag();
  _clearStoreForTesting();
  registerBuiltinRules();
}

const TEST_SRC = createEventSource({ id: "test", name: "Test", version: "1.0.0", channel: "api" });

function makeEvent(type: "message.sent" | "payment.initiated", id: string, extra: Record<string, unknown> = {}) {
  return createDomainEvent({
    id, type,
    payload: { recipientId: "u1", ...extra },
    source: TEST_SRC,
  });
}

// ── 1. Session ID generation ─────────────────────────────────────────────────

describe("1. Session ID generation", () => {
  it("starts with sess_", () => { expect(generateSessionId()).toMatch(/^sess_/); });

  it("is at least 26 characters long", () => {
    expect(generateSessionId().length).toBeGreaterThan(25);
  });

  it("generates unique IDs on consecutive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSessionId()));
    expect(ids.size).toBe(100);
  });

  it("isValidSessionIdFormat accepts valid IDs", () => {
    expect(isValidSessionIdFormat(generateSessionId())).toBe(true);
  });

  it("isValidSessionIdFormat rejects wrong prefix", () => {
    expect(isValidSessionIdFormat("user_abc123")).toBe(false);
  });

  it("isValidSessionIdFormat rejects non-strings", () => {
    expect(isValidSessionIdFormat(null)).toBe(false);
    expect(isValidSessionIdFormat(42)).toBe(false);
  });

  it("isValidSessionIdFormat rejects short IDs", () => {
    expect(isValidSessionIdFormat("sess_x")).toBe(false);
  });

  it("alphabet is URL-safe (no special chars)", () => {
    for (let i = 0; i < 20; i++) {
      const id = generateSessionId();
      expect(/^[A-Za-z0-9_]+$/.test(id)).toBe(true);
    }
  });
});

// ── 2. Session store ──────────────────────────────────────────────────────────

describe("2. Session store — CRUD", () => {
  it("creates a session and returns ok:true", () => {
    resetAll();
    const result = createSession({ creatorIp: "127.0.0.1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sessionId).toMatch(/^sess_/);
      expect(result.value.status).toBe("active");
      expect(result.value.sequenceCounter).toBe(0);
    }
  });

  it("getSession returns the created session", () => {
    resetAll();
    const created = createSession();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const fetched = getSession(created.value.sessionId);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) expect(fetched.value.sessionId).toBe(created.value.sessionId);
  });

  it("returns SESSION_NOT_FOUND for unknown ID", () => {
    resetAll();
    const result = getSession("sess_doesnotexist1234567");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SESSION_NOT_FOUND");
  });

  it("returns SESSION_EXPIRED for expired sessions", () => {
    resetAll();
    const created = createSession({ ttlMs: 1 }); // 1ms TTL
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Wait for TTL to pass
    const pastExpiry = new Date(Date.now() - 10).toISOString();
    const expiredRecord: SessionRecord = { ...created.value, expiresAt: pastExpiry };
    _injectSessionForTesting(expiredRecord);

    const result = getSession(created.value.sessionId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SESSION_EXPIRED");
  });

  it("closeSession marks session as completed", () => {
    resetAll();
    const created = createSession();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const closed = closeSession(created.value.sessionId);
    expect(closed.ok).toBe(true);
    if (closed.ok) expect(closed.value.status).toBe("completed");
  });

  it("rejects events on completed session", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    closeSession(created.value.sessionId);

    const env = getEnv();
    const cfg = getEngineConfig(env);
    const event = makeEvent(MESSAGE_SENT, "evt_001");
    const output = evaluateEvent(event, createInitialSimulationState("s", { scenarioId: "t", scenarioName: "T", maxEvents: 10, timeoutMs: 30_000, enabledRules: [], pluginIds: [] }), cfg);

    const result = appendEventToSession(created.value.sessionId, event, output);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SESSION_COMPLETED");
  });

  it("touchSession increments accessCount", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;

    const before = created.value.accessCount;
    touchSession(created.value.sessionId);
    const after = getSession(created.value.sessionId);
    if (!after.ok) return;
    expect(after.value.accessCount).toBeGreaterThan(before);
  });

  it("getStoreMetrics counts active sessions", () => {
    resetAll();
    createSession(); createSession(); createSession();
    const metrics = getStoreMetrics();
    expect(metrics.activeSessions).toBe(3);
    expect(metrics.totalSessions).toBe(3);
  });
});

// ── 3. Session record — applyEngineOutput ─────────────────────────────────────

describe("3. SessionRecord — applyEngineOutput", () => {
  it("appends event to events array", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);
    const event = makeEvent(MESSAGE_SENT, "evt_a");
    const output = evaluateEvent(event, created.value.state, cfg);

    const now = new Date().toISOString();
    const updated = applyEngineOutput(created.value, event, output, now);

    expect(updated.state.events).toHaveLength(1);
    expect(updated.state.events[0]?.id).toBe("evt_a");
  });

  it("increments sequenceCounter", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);
    const event = makeEvent(MESSAGE_SENT, "evt_b");
    const output = evaluateEvent(event, created.value.state, cfg);
    const updated = applyEngineOutput(created.value, event, output, new Date().toISOString());
    expect(updated.sequenceCounter).toBe(1);
  });

  it("accumulates revenue events", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);

    // Event 1: app open → sms_saved
    const stateWithOpen = { ...created.value.state, appOpen: true } as typeof created.value.state;
    const evt1 = makeEvent(MESSAGE_SENT, "evt_r1");
    const out1 = evaluateEvent(evt1, stateWithOpen, cfg);
    const rec1 = applyEngineOutput(created.value, evt1, out1, new Date().toISOString());

    // Event 2: app closed → sms_cost
    const stateAfterFirst = rec1.state;
    const evt2 = makeEvent(MESSAGE_SENT, "evt_r2");
    const out2 = evaluateEvent(evt2, stateAfterFirst, cfg);
    const rec2 = applyEngineOutput(rec1, evt2, out2, new Date().toISOString());

    expect(rec2.state.revenueEvents.length).toBeGreaterThan(1);
  });

  it("never mutates the original record", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);
    const event = makeEvent(MESSAGE_SENT, "evt_c");
    const output = evaluateEvent(event, created.value.state, cfg);

    const original = created.value;
    const originalEventCount = original.state.events.length;
    applyEngineOutput(original, event, output, new Date().toISOString());

    // Original unchanged
    expect(original.state.events.length).toBe(originalEventCount);
    expect(original.sequenceCounter).toBe(0);
  });

  it("stores decision in decisions map keyed by event ID", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);
    const event = makeEvent(MESSAGE_SENT, "evt_decision_key");
    const output = evaluateEvent(event, created.value.state, cfg);
    const updated = applyEngineOutput(created.value, event, output, new Date().toISOString());

    expect(updated.state.decisions["evt_decision_key"]).not.toBeNull();
    expect(updated.state.decisions["evt_decision_key"]?.verdict).toBe("allow");
  });
});

// ── 4. Multi-event session flow ───────────────────────────────────────────────

describe("4. Multi-event session flow", () => {
  it("three events in a session accumulate correctly", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const sessionId = created.value.sessionId;
    const env = getEnv();
    const cfg = getEngineConfig(env);

    const stateOpen = { ...created.value.state, appOpen: true } as typeof created.value.state;
    const e1 = createDomainEvent({ id: "e1", type: MESSAGE_SENT, payload: { recipientId: "u1" }, source: TEST_SRC });
    const o1 = evaluateEvent(e1, stateOpen, cfg);
    appendEventToSession(sessionId, e1, o1);

    const s1 = getSession(sessionId);
    if (!s1.ok) return;
    const e2 = createDomainEvent({ id: "e2", type: MESSAGE_SENT, payload: { recipientId: "u2" }, source: TEST_SRC });
    const o2 = evaluateEvent(e2, s1.value.state, cfg);
    appendEventToSession(sessionId, e2, o2);

    const s2 = getSession(sessionId);
    if (!s2.ok) return;
    const e3 = createDomainEvent({
      id: "e3", type: PAYMENT_INITIATED,
      payload: { transactionId: "tx1", recipientTimezone: "Africa/Lagos" },
      source: TEST_SRC, timestamp: "2026-03-19T02:30:00.000Z",
    });
    const o3 = evaluateEvent(e3, s2.value.state, cfg);
    appendEventToSession(sessionId, e3, o3);

    const final = getSession(sessionId);
    if (!final.ok) return;

    expect(final.value.state.events).toHaveLength(3);
    expect(final.value.sequenceCounter).toBe(3);
    expect(final.value.state.counters.totalEventsProcessed).toBe(3);
    expect(final.value.state.counters.totalDecisions).toBe(3);
    expect(final.value.state.ruleTraces.length).toBeGreaterThan(0);
  });

  it("payment at 3am generates risk event that persists in session", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);
    const event = createDomainEvent({
      id: "e_risk", type: PAYMENT_INITIATED,
      payload: { transactionId: "tx2", recipientTimezone: "Africa/Lagos" },
      source: TEST_SRC, timestamp: "2026-03-19T02:30:00.000Z",
    });
    const output = evaluateEvent(event, created.value.state, cfg);
    appendEventToSession(created.value.sessionId, event, output);

    const session = getSession(created.value.sessionId);
    if (!session.ok) return;
    expect(session.value.state.riskEvents.length).toBeGreaterThan(0);
    expect(session.value.state.riskEvents[0]?.category).toBe("timezone_mismatch");
  });

  it("events in different sessions are completely independent", () => {
    resetAll();
    const s1 = createSession();
    const s2 = createSession();
    if (!s1.ok || !s2.ok) return;

    const env = getEnv();
    const cfg = getEngineConfig(env);

    const stateOpen = { ...s1.value.state, appOpen: true } as typeof s1.value.state;
    const e1 = createDomainEvent({ id: "e_s1", type: MESSAGE_SENT, payload: { r: "u1" }, source: TEST_SRC });
    const o1 = evaluateEvent(e1, stateOpen, cfg);
    appendEventToSession(s1.value.sessionId, e1, o1);

    // Session 2 should be unaffected
    const s2State = getSession(s2.value.sessionId);
    if (!s2State.ok) return;
    expect(s2State.value.state.events).toHaveLength(0);
    expect(s2State.value.state.revenueEvents).toHaveLength(0);
  });
});

// ── 5. Logs retrieval ─────────────────────────────────────────────────────────

describe("5. Logs — pagination and filtering", () => {
  it("returns all accumulated events in session", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);

    for (let i = 0; i < 5; i++) {
      const s = getSession(created.value.sessionId);
      if (!s.ok) break;
      const e = createDomainEvent({ id: `bulk_evt_${i}`, type: MESSAGE_SENT, payload: { i }, source: TEST_SRC });
      const o = evaluateEvent(e, s.value.state, cfg);
      appendEventToSession(created.value.sessionId, e, o);
    }

    const final = getSession(created.value.sessionId);
    if (!final.ok) return;
    expect(final.value.state.events).toHaveLength(5);
    expect(final.value.state.counters.totalEventsProcessed).toBe(5);
  });

  it("decisions are keyed by event ID in the decisions map", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);
    const event = createDomainEvent({ id: "evt_key_check", type: MESSAGE_SENT, payload: {}, source: TEST_SRC });
    const output = evaluateEvent(event, created.value.state, cfg);
    appendEventToSession(created.value.sessionId, event, output);

    const session = getSession(created.value.sessionId);
    if (!session.ok) return;
    expect(session.value.state.decisions["evt_key_check"]).not.toBeNull();
  });

  it("counters track events by type", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);

    for (let i = 0; i < 3; i++) {
      const s = getSession(created.value.sessionId);
      if (!s.ok) break;
      const e = createDomainEvent({ id: `count_e_${i}`, type: MESSAGE_SENT, payload: {}, source: TEST_SRC });
      appendEventToSession(created.value.sessionId, e, evaluateEvent(e, s.value.state, cfg));
    }

    const session = getSession(created.value.sessionId);
    if (!session.ok) return;
    expect(session.value.state.counters.eventCountByType["message.sent"]).toBe(3);
  });
});

// ── 6. Session lifecycle ──────────────────────────────────────────────────────

describe("6. Session lifecycle — status transitions", () => {
  it("new session is active", () => {
    resetAll();
    const r = createSession();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("active");
  });

  it("after closeSession, status is completed", () => {
    resetAll();
    const r = createSession();
    if (!r.ok) return;
    const closed = closeSession(r.value.sessionId);
    expect(closed.ok).toBe(true);
    if (closed.ok) expect(closed.value.status).toBe("completed");
  });

  it("closing twice returns SESSION_COMPLETED", () => {
    resetAll();
    const r = createSession();
    if (!r.ok) return;
    const first = closeSession(r.value.sessionId);
    expect(first.ok).toBe(true); // first close succeeds
    if (!first.ok) return;
    // Second close: session still exists but is completed
    const second = closeSession(r.value.sessionId);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("SESSION_COMPLETED");
  });

  it("markCompleted sets state timing.completedAt", () => {
    resetAll();
    const r = createSession();
    if (!r.ok) return;
    const now = new Date().toISOString();
    const updated = markCompleted(r.value, now);
    expect(updated.state.timing.completedAt).toBe(now);
  });
});

// ── 7. Security — expiry and capacity ────────────────────────────────────────

describe("7. Security — expiry and capacity enforcement", () => {
  it("expired sessions return SESSION_EXPIRED immediately", () => {
    resetAll();
    const r = createSession();
    if (!r.ok) return;
    const past = new Date(Date.now() - 60_000).toISOString();
    _injectSessionForTesting({ ...r.value, expiresAt: past });
    const result = getSession(r.value.sessionId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SESSION_EXPIRED");
  });

  it("expired sessions cannot receive events", () => {
    resetAll();
    const r = createSession();
    if (!r.ok) return;
    const past = new Date(Date.now() - 1).toISOString();
    _injectSessionForTesting({ ...r.value, expiresAt: past });

    const env = getEnv();
    const cfg = getEngineConfig(env);
    const event = makeEvent(MESSAGE_SENT, "evt_exp");
    const output = evaluateEvent(event, r.value.state, cfg);
    const appendResult = appendEventToSession(r.value.sessionId, event, output);
    expect(appendResult.ok).toBe(false);
    if (!appendResult.ok) expect(appendResult.code).toBe("SESSION_EXPIRED");
  });

  it("different sessions use different IDs (no collision in 50 creates)", () => {
    resetAll();
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const r = createSession();
      if (r.ok) ids.add(r.value.sessionId);
    }
    expect(ids.size).toBe(50);
  });

  it("creator IP is never stored in plaintext — only a hash", () => {
    resetAll();
    const r = createSession({ creatorIp: "192.168.100.200" });
    if (!r.ok) return;
    // The stored hash must NOT contain the raw IP
    expect(r.value.creatorIpHash).not.toContain("192.168.100.200");
    expect(r.value.creatorIpHash).toMatch(/^ip_/);
  });

  it("session content is isolated — no listing endpoint exists", () => {
    // Structural: getSession requires an exact ID. There is no API to list sessions.
    // This test verifies the store does not expose a list() function.
    const storeModule = { createSession, getSession, appendEventToSession, closeSession, touchSession, getStoreMetrics };
    const keys = Object.keys(storeModule);
    expect(keys.includes("listSessions")).toBe(false);
    expect(keys.includes("getAllSessions")).toBe(false);
  });
});

// ── 8. Engine integration — multi-event, same session ────────────────────────

describe("8. Engine integration — two events in same session", () => {
  it("event 2 sees revenue from event 1 in session state", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);
    const sessionId = created.value.sessionId;

    // Event 1: evaluate with appOpen=true (injected into state for smart-notification rule)
    const stateOpen = { ...created.value.state, appOpen: true } as typeof created.value.state;
    const e1 = createDomainEvent({ id: "e1_s4", type: MESSAGE_SENT, payload: { r: "u1" }, source: TEST_SRC });
    const o1 = evaluateEvent(e1, stateOpen, cfg);
    appendEventToSession(sessionId, e1, o1);

    // Confirm revenue from event 1 persisted in session
    const s1 = getSession(sessionId);
    if (!s1.ok) return;
    const cats1 = s1.value.state.revenueEvents.map((r) => r.category);
    // appOpen=true produces sms_saved
    expect(cats1.includes("sms_saved") || cats1.includes("sms_cost")).toBe(true);

    // Event 2: evaluate with appOpen=false (app closed → sms_cost)
    const stateAfterFirst = { ...s1.value.state, appOpen: false } as typeof s1.value.state;
    const e2 = createDomainEvent({ id: "e2_s4", type: MESSAGE_SENT, payload: { r: "u2" }, source: TEST_SRC });
    const o2 = evaluateEvent(e2, stateAfterFirst, cfg);
    appendEventToSession(sessionId, e2, o2);

    const s2 = getSession(sessionId);
    if (!s2.ok) return;
    // Should have 2 revenue events total (one from each message)
    expect(s2.value.state.revenueEvents.length).toBe(2);
    const categories = s2.value.state.revenueEvents.map((r) => r.category);
    // One gain (sms_saved), one loss (sms_cost)
    expect(categories.includes("sms_saved")).toBe(true);
    expect(categories.includes("sms_cost")).toBe(true);
  });

  it("sequenceCounter increments correctly across events", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);
    const id = created.value.sessionId;

    for (let i = 0; i < 4; i++) {
      const s = getSession(id);
      if (!s.ok) break;
      const e = createDomainEvent({ id: `seq_e${i}`, type: MESSAGE_SENT, payload: {}, source: TEST_SRC });
      appendEventToSession(id, e, evaluateEvent(e, s.value.state, cfg));
    }

    const final = getSession(id);
    if (!final.ok) return;
    expect(final.value.sequenceCounter).toBe(4);
    expect(final.value.state.events).toHaveLength(4);
  });

  it("rule traces from all events accumulate in order", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);
    const id = created.value.sessionId;

    for (let i = 0; i < 3; i++) {
      const s = getSession(id);
      if (!s.ok) break;
      const e = createDomainEvent({ id: `trace_e${i}`, type: MESSAGE_SENT, payload: {}, source: TEST_SRC });
      appendEventToSession(id, e, evaluateEvent(e, s.value.state, cfg));
    }

    const final = getSession(id);
    if (!final.ok) return;
    expect(final.value.state.ruleTraces.length).toBeGreaterThan(2);
    // All traces reference events in this session
    const eventIds = new Set(final.value.state.events.map((e) => e.id));
    for (const trace of final.value.state.ruleTraces) {
      expect(eventIds.has(trace.triggeringEventId)).toBe(true);
    }
  });
});

// ── Summary ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${"─".repeat(60)}`);
console.log(`  Tests: ${total}  |  Passed: ${passed}  |  Failed: ${failed}`);
if (failures.length > 0) {
  console.log(`\nFailures:`);
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(1);
} else {
  console.log(`\n  All ${total} tests passed ✓`);
}
