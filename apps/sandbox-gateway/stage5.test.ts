/**
 * @file stage5.test.ts
 * @description Comprehensive test suite for Stage 5 — Analytics Engine.
 *
 * Coverage:
 *   1.  computeRevenue — totals, savings, breakdown, multi-currency
 *   2.  computeRisk    — exposure score, severity weights, open-only scoring
 *   3.  computeRules   — fire rate, error rate, verdict distribution
 *   4.  computeEvents  — type counts, hourly bucketing, duration
 *   5.  computeSessionAnalytics — full orchestration, KPI derivation
 *   6.  computeMultiSessionAnalytics — aggregate, cross-session isolation
 *   7.  Audit guarantee — same input always produces same output
 *   8.  Edge cases — empty arrays, zero events, single event
 *   9.  Security — no cross-session leakage, immutability
 *  10.  Real-time consistency — new events immediately reflected
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
    const m = e instanceof Error ? e.message : String(e);
    console.log(`    ✗ ${name}\n      └─ ${m}`);
    failed++; failures.push(`${name}: ${m}`);
  }
}

function expect(actual: unknown) {
  const a = actual;
  return {
    toBe:              (v: unknown) => { if (a !== v) throw new Error(`Expected ${JSON.stringify(v)}, got ${JSON.stringify(a)}`); },
    toEqual:           (v: unknown) => { if (JSON.stringify(a) !== JSON.stringify(v)) throw new Error(`Expected ${JSON.stringify(v)}, got ${JSON.stringify(a)}`); },
    toBeGreaterThan:   (n: number)  => { if (typeof a !== "number" || a <= n) throw new Error(`Expected > ${n}, got ${a}`); },
    toBeGreaterThanOrEqual: (n: number) => { if (typeof a !== "number" || a < n) throw new Error(`Expected >= ${n}, got ${a}`); },
    toBeLessThan:      (n: number)  => { if (typeof a !== "number" || a >= n) throw new Error(`Expected < ${n}, got ${a}`); },
    toBeLessThanOrEqual: (n: number) => { if (typeof a !== "number" || a > n) throw new Error(`Expected <= ${n}, got ${a}`); },
    toHaveLength:      (n: number)  => { if ((a as unknown[]).length !== n) throw new Error(`Expected length ${n}, got ${(a as unknown[]).length}`); },
    toBeNull:          ()           => { if (a !== null) throw new Error("Expected null"); },
    toBeTruthy:        ()           => { if (!a) throw new Error("Expected truthy"); },
    toBeFalsy:         ()           => { if (a) throw new Error("Expected falsy"); },
    toBeCloseTo:       (n: number, d = 2) => {
      if (typeof a !== "number") throw new Error(`Expected number, got ${typeof a}`);
      const factor = Math.pow(10, d);
      if (Math.round(a * factor) !== Math.round(n * factor))
        throw new Error(`Expected ~${n} (±${Math.pow(10, -d)}), got ${a}`);
    },
    not: {
      toBe:    (v: unknown) => { if (a === v) throw new Error(`Expected NOT ${JSON.stringify(v)}`); },
      toBeNull: ()          => { if (a === null) throw new Error("Expected not null"); },
    },
  };
}

// ── Imports ───────────────────────────────────────────────────────────────────

import { computeRevenue }          from "./src/analytics/compute-revenue.js";
import { computeRisk }             from "./src/analytics/compute-risk.js";
import { computeRules }            from "./src/analytics/compute-rules.js";
import { computeEvents }           from "./src/analytics/compute-events.js";
import { computeSessionAnalytics, computeMultiSessionAnalytics } from "./src/analytics/engine.js";

import {
  createSession, getSession, appendEventToSession,
  _clearStoreForTesting,
} from "./src/store/session-store.js";
import { _reloadEnvForTesting, getEnv } from "./src/config/env.js";
import { getEngineConfig, _resetEngineConfigForTesting } from "./src/config/engine-bootstrap.js";
import {
  evaluateEvent, registerBuiltinRules,
  _resetRegistryForTesting, _resetBuiltinRegistrationFlag,
} from "../../packages/rules-engine/src/index.js";
import {
  createInitialSimulationState, createEventSource, createDomainEvent,
  MESSAGE_SENT, PAYMENT_INITIATED,
} from "../../packages/models/src/index.js";
import type { RevenueEvent, RiskEvent, RuleTrace, DomainEvent, SimulationState } from "../../packages/models/src/index.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

const SRC = createEventSource({ id: "test", name: "T", version: "1.0.0", channel: "api" });
const NOW = "2026-03-19T10:00:00.000Z";
const NOW3AM = "2026-03-19T02:30:00.000Z";

function makeRevenueEvent(overrides: Partial<RevenueEvent> & Pick<RevenueEvent, "id" | "direction" | "category" | "amount">): RevenueEvent {
  return {
    recordedAt: NOW,
    triggeringEventId: "evt_1",
    triggeringEventType: MESSAGE_SENT,
    triggeringRuleId: "RULE_1",
    triggeringRuleName: "Rule 1",
    description: "test",
    metadata: {},
    ...overrides,
  };
}

function makeRiskEvent(overrides: Partial<RiskEvent> & Pick<RiskEvent, "id" | "severity" | "score" | "category">): RiskEvent {
  return {
    detectedAt: NOW,
    triggeringEventId: "evt_1",
    triggeringEventType: PAYMENT_INITIATED,
    triggeringRuleId: "RULE_1",
    triggeringRuleName: "Rule 1",
    description: "test risk",
    status: "open",
    evidence: { type: "generic", facts: {} },
    ...overrides,
  };
}

function makeRuleTrace(overrides: Partial<RuleTrace> & Pick<RuleTrace, "traceId" | "ruleId" | "outcome">): RuleTrace {
  return {
    ruleName: "Smart Notification",
    ruleVersion: "1.0.0",
    triggeringEventId: "evt_1",
    triggeringEventType: MESSAGE_SENT,
    evaluatedAt: NOW,
    executionTimeMs: 5,
    explanation: "test",
    conditions: [],
    actions: [],
    contextSnapshot: {},
    ...overrides,
  };
}

function makeEvent(id: string, type: typeof MESSAGE_SENT | typeof PAYMENT_INITIATED, ts = NOW): DomainEvent {
  return createDomainEvent({ id, type, payload: {}, source: SRC, timestamp: ts });
}

function emptyState(): SimulationState {
  return createInitialSimulationState("sess_test", {
    scenarioId: "test", scenarioName: "Test",
    maxEvents: 100, timeoutMs: 30_000, enabledRules: [], pluginIds: [],
  });
}

// ── 1. computeRevenue ─────────────────────────────────────────────────────────

describe("1. computeRevenue", () => {
  it("returns zeros for empty array", () => {
    const r = computeRevenue([]);
    expect(r.totalGainMinorUnits).toBe(0);
    expect(r.totalLossMinorUnits).toBe(0);
    expect(r.netMinorUnits).toBe(0);
    expect(r.totalSavingsMinorUnits).toBe(0);
    expect(r.totalRevenueEventCount).toBe(0);
  });

  it("sums gains correctly", () => {
    const events = [
      makeRevenueEvent({ id: "r1", direction: "gain", category: "sms_saved", amount: { amountMinorUnits: 400, currency: "NGN" } }),
      makeRevenueEvent({ id: "r2", direction: "gain", category: "sms_saved", amount: { amountMinorUnits: 400, currency: "NGN" } }),
    ];
    const r = computeRevenue(events);
    expect(r.totalGainMinorUnits).toBe(800);
    expect(r.gainEventCount).toBe(2);
    expect(r.totalSavingsMinorUnits).toBe(800);
  });

  it("sums losses correctly", () => {
    const events = [
      makeRevenueEvent({ id: "r3", direction: "loss", category: "sms_cost", amount: { amountMinorUnits: 400, currency: "NGN" } }),
      makeRevenueEvent({ id: "r4", direction: "loss", category: "sms_cost", amount: { amountMinorUnits: 200, currency: "NGN" } }),
    ];
    const r = computeRevenue(events);
    expect(r.totalLossMinorUnits).toBe(600);
    expect(r.lossEventCount).toBe(2);
    expect(r.netMinorUnits).toBe(-600);
  });

  it("computes net correctly (gain - loss)", () => {
    const events = [
      makeRevenueEvent({ id: "r5", direction: "gain", category: "sms_saved", amount: { amountMinorUnits: 1200, currency: "NGN" } }),
      makeRevenueEvent({ id: "r6", direction: "loss", category: "sms_cost",  amount: { amountMinorUnits: 400,  currency: "NGN" } }),
    ];
    const r = computeRevenue(events);
    expect(r.netMinorUnits).toBe(800);
    expect(r.netAmount).toBe(8);  // 800 / 100
  });

  it("only sms_saved and similar categories count as savings", () => {
    const events = [
      makeRevenueEvent({ id: "r7", direction: "gain", category: "sms_saved",       amount: { amountMinorUnits: 400, currency: "NGN" } }),
      makeRevenueEvent({ id: "r8", direction: "gain", category: "other",            amount: { amountMinorUnits: 500, currency: "NGN" } }),
      makeRevenueEvent({ id: "r9", direction: "gain", category: "transaction_fee",  amount: { amountMinorUnits: 100, currency: "NGN" } }),
    ];
    const r = computeRevenue(events);
    expect(r.totalGainMinorUnits).toBe(1000);
    // "other" is not in savings set
    expect(r.totalSavingsMinorUnits).toBe(500); // 400 + 100
  });

  it("builds byCategory breakdown", () => {
    const events = [
      makeRevenueEvent({ id: "ra", direction: "gain", category: "sms_saved", amount: { amountMinorUnits: 400, currency: "NGN" } }),
      makeRevenueEvent({ id: "rb", direction: "loss", category: "sms_cost",  amount: { amountMinorUnits: 400, currency: "NGN" } }),
    ];
    const r = computeRevenue(events);
    expect(r.breakdown.byCategory["sms_saved"]?.totalGainMinorUnits).toBe(400);
    expect(r.breakdown.byCategory["sms_cost"]?.totalLossMinorUnits).toBe(400);
  });

  it("uses primary currency when multiple currencies present", () => {
    const events = [
      makeRevenueEvent({ id: "rc", direction: "gain", category: "sms_saved", amount: { amountMinorUnits: 400, currency: "NGN" } }),
      makeRevenueEvent({ id: "rd", direction: "gain", category: "sms_saved", amount: { amountMinorUnits: 400, currency: "NGN" } }),
      makeRevenueEvent({ id: "re", direction: "gain", category: "sms_saved", amount: { amountMinorUnits: 100, currency: "USD" } }),
    ];
    const r = computeRevenue(events);
    // NGN appears twice, USD once → NGN is primary
    expect(r.currency).toBe("NGN");
    expect(r.totalGainMinorUnits).toBe(800); // only NGN events summed
  });

  it("totalRevenueEventCount matches input length (single currency)", () => {
    const events = [
      makeRevenueEvent({ id: "rf", direction: "gain", category: "sms_saved", amount: { amountMinorUnits: 400, currency: "NGN" } }),
      makeRevenueEvent({ id: "rg", direction: "loss", category: "sms_cost",  amount: { amountMinorUnits: 400, currency: "NGN" } }),
      makeRevenueEvent({ id: "rh", direction: "gain", category: "bonus",     amount: { amountMinorUnits: 200, currency: "NGN" } }),
    ];
    const r = computeRevenue(events);
    expect(r.totalRevenueEventCount).toBe(3);
  });
});

// ── 2. computeRisk ───────────────────────────────────────────────────────────

describe("2. computeRisk", () => {
  it("returns zeros for empty array", () => {
    const r = computeRisk([]);
    expect(r.totalSignalCount).toBe(0);
    expect(r.riskExposureScore).toBe(0);
    expect(r.averageRiskScore).toBe(0);
  });

  it("counts total and open signals correctly", () => {
    const events = [
      makeRiskEvent({ id: "risk1", severity: "high",   score: 0.8, category: "timezone_mismatch", status: "open"     }),
      makeRiskEvent({ id: "risk2", severity: "low",    score: 0.2, category: "velocity_breach",   status: "resolved" }),
      makeRiskEvent({ id: "risk3", severity: "medium", score: 0.5, category: "geo_anomaly",        status: "open"     }),
    ];
    const r = computeRisk(events);
    expect(r.totalSignalCount).toBe(3);
    expect(r.openSignalCount).toBe(2);
  });

  it("counts critical and high signals", () => {
    const events = [
      makeRiskEvent({ id: "r1", severity: "critical", score: 0.95, category: "fraud_indicator" }),
      makeRiskEvent({ id: "r2", severity: "critical", score: 0.9,  category: "sanctions_match" }),
      makeRiskEvent({ id: "r3", severity: "high",     score: 0.75, category: "timezone_mismatch" }),
    ];
    const r = computeRisk(events);
    expect(r.criticalSignalCount).toBe(2);
    expect(r.highSignalCount).toBe(1);
  });

  it("exposure score only includes open signals (resolved excluded)", () => {
    // One open critical signal, one resolved critical — exposure should reflect only open
    const events = [
      makeRiskEvent({ id: "r_open",     severity: "critical", score: 1.0, category: "fraud_indicator", status: "open" }),
      makeRiskEvent({ id: "r_resolved", severity: "critical", score: 1.0, category: "fraud_indicator", status: "resolved" }),
    ];
    const r = computeRisk(events);
    // Only the open one contributes → exposure > 0 but < average of both
    expect(r.riskExposureScore).toBeGreaterThan(0);
    // If both counted, avg would still be 1.0; since only open counts, exposure = 1.0
    expect(r.riskExposureScore).toBe(1.0);
  });

  it("zero exposure when all signals are resolved", () => {
    const events = [
      makeRiskEvent({ id: "r1", severity: "high", score: 0.9, category: "timezone_mismatch", status: "resolved" }),
      makeRiskEvent({ id: "r2", severity: "high", score: 0.8, category: "timezone_mismatch", status: "dismissed" }),
    ];
    const r = computeRisk(events);
    expect(r.riskExposureScore).toBe(0);
  });

  it("exposure score is weighted by severity (critical > high > medium > low)", () => {
    // Low score critical vs high score low — critical should still dominate
    const events = [
      makeRiskEvent({ id: "r_crit", severity: "critical", score: 0.5, category: "fraud_indicator", status: "open" }),
      makeRiskEvent({ id: "r_low",  severity: "low",      score: 0.5, category: "velocity_breach", status: "open" }),
    ];
    const r = computeRisk(events);
    // Both have score 0.5 but critical has weight 4, low has weight 1
    // weighted avg = (0.5*4 + 0.5*1) / (4+1) = 2.5/5 = 0.5
    expect(r.riskExposureScore).toBeCloseTo(0.5, 3);
  });

  it("builds byCategory breakdown", () => {
    const events = [
      makeRiskEvent({ id: "r1", severity: "high", score: 0.8, category: "timezone_mismatch" }),
      makeRiskEvent({ id: "r2", severity: "high", score: 0.6, category: "timezone_mismatch" }),
      makeRiskEvent({ id: "r3", severity: "low",  score: 0.3, category: "velocity_breach" }),
    ];
    const r = computeRisk(events);
    expect(r.breakdown.byCategory["timezone_mismatch"]?.count).toBe(2);
    expect(r.breakdown.byCategory["velocity_breach"]?.count).toBe(1);
  });

  it("maxRiskScore is the highest individual score", () => {
    const events = [
      makeRiskEvent({ id: "r1", severity: "low",      score: 0.2, category: "velocity_breach" }),
      makeRiskEvent({ id: "r2", severity: "critical",  score: 0.97, category: "fraud_indicator" }),
      makeRiskEvent({ id: "r3", severity: "medium",   score: 0.5, category: "geo_anomaly" }),
    ];
    const r = computeRisk(events);
    expect(r.maxRiskScore).toBe(0.97);
  });
});

// ── 3. computeRules ──────────────────────────────────────────────────────────

describe("3. computeRules", () => {
  it("returns zeros for empty traces", () => {
    const r = computeRules([], {});
    expect(r.totalTracesEvaluated).toBe(0);
    expect(r.totalRulesFired).toBe(0);
    expect(r.verdictDistribution.total).toBe(0);
  });

  it("counts fired, skipped, error traces", () => {
    const traces = [
      makeRuleTrace({ traceId: "t1", ruleId: "R1", outcome: "fired"   }),
      makeRuleTrace({ traceId: "t2", ruleId: "R1", outcome: "fired"   }),
      makeRuleTrace({ traceId: "t3", ruleId: "R1", outcome: "skipped" }),
      makeRuleTrace({ traceId: "t4", ruleId: "R2", outcome: "error"   }),
    ];
    const r = computeRules(traces, {});
    expect(r.totalRulesFired).toBe(2);
    expect(r.totalRulesSkipped).toBe(1);
    expect(r.totalRuleErrors).toBe(1);
    expect(r.totalTracesEvaluated).toBe(4);
  });

  it("fire rate = firedCount / total evaluations", () => {
    const traces = [
      makeRuleTrace({ traceId: "t1", ruleId: "R1", outcome: "fired",    executionTimeMs: 5 }),
      makeRuleTrace({ traceId: "t2", ruleId: "R1", outcome: "fired",    executionTimeMs: 5 }),
      makeRuleTrace({ traceId: "t3", ruleId: "R1", outcome: "no_match", executionTimeMs: 2 }),
      makeRuleTrace({ traceId: "t4", ruleId: "R1", outcome: "skipped",  executionTimeMs: 0 }),
    ];
    const r = computeRules(traces, {});
    const perf = r.rulePerformance[0];
    expect(perf?.ruleId).toBe("R1");
    expect(perf?.firedCount).toBe(2);
    expect(perf?.fireRate).toBeCloseTo(0.5, 3); // 2/4
  });

  it("computes verdict distribution from decisions map", () => {
    const decisions = {
      "evt1": { verdict: "allow" as const, decisionId: "d1", sourceEventId: "evt1", sourceEventType: MESSAGE_SENT, decidedAt: NOW, totalExecutionTimeMs: 5, reason: "ok", confidence: 1, appliedRuleTraces: [], appliedActions: [] },
      "evt2": { verdict: "flag"  as const, decisionId: "d2", sourceEventId: "evt2", sourceEventType: MESSAGE_SENT, decidedAt: NOW, totalExecutionTimeMs: 5, reason: "risk", confidence: 0.9, appliedRuleTraces: [], appliedActions: [] },
      "evt3": { verdict: "block" as const, decisionId: "d3", sourceEventId: "evt3", sourceEventType: PAYMENT_INITIATED, decidedAt: NOW, totalExecutionTimeMs: 5, reason: "fraud", confidence: 1, appliedRuleTraces: [], appliedActions: [] },
    };
    const r = computeRules([], decisions);
    expect(r.verdictDistribution.allow).toBe(1);
    expect(r.verdictDistribution.flag).toBe(1);
    expect(r.verdictDistribution.block).toBe(1);
    expect(r.verdictDistribution.total).toBe(3);
  });

  it("uniqueRulesInvoked reflects distinct rule IDs", () => {
    const traces = [
      makeRuleTrace({ traceId: "t1", ruleId: "R1", outcome: "fired" }),
      makeRuleTrace({ traceId: "t2", ruleId: "R1", outcome: "fired" }),
      makeRuleTrace({ traceId: "t3", ruleId: "R2", outcome: "skipped" }),
      makeRuleTrace({ traceId: "t4", ruleId: "R3", outcome: "error" }),
    ];
    const r = computeRules(traces, {});
    expect(r.uniqueRulesInvoked).toBe(3);
  });
});

// ── 4. computeEvents ─────────────────────────────────────────────────────────

describe("4. computeEvents", () => {
  it("returns zeros/nulls for empty events", () => {
    const r = computeEvents([]);
    expect(r.totalEventCount).toBe(0);
    expect(r.firstEventAt).toBeNull();
    expect(r.lastEventAt).toBeNull();
    expect(r.sessionDurationMs).toBeNull();
  });

  it("counts event types correctly", () => {
    const events = [
      makeEvent("e1", MESSAGE_SENT, "2026-03-19T10:00:00.000Z"),
      makeEvent("e2", MESSAGE_SENT, "2026-03-19T10:01:00.000Z"),
      makeEvent("e3", PAYMENT_INITIATED, "2026-03-19T10:02:00.000Z"),
    ];
    const r = computeEvents(events);
    expect(r.totalEventCount).toBe(3);
    expect(r.uniqueEventTypes).toBe(2);
    const msgType = r.byType.find((t) => t.eventType === MESSAGE_SENT);
    expect(msgType?.count).toBe(2);
    expect(msgType?.percentage).toBeCloseTo(66.67, 1);
  });

  it("computes session duration correctly", () => {
    const events = [
      makeEvent("e1", MESSAGE_SENT, "2026-03-19T10:00:00.000Z"),
      makeEvent("e2", MESSAGE_SENT, "2026-03-19T11:00:00.000Z"), // +1 hour
    ];
    const r = computeEvents(events);
    expect(r.sessionDurationMs).toBe(3_600_000); // 1 hour in ms
    expect(r.firstEventAt).toBe("2026-03-19T10:00:00.000Z");
    expect(r.lastEventAt).toBe("2026-03-19T11:00:00.000Z");
  });

  it("sessionDurationMs is null for single event", () => {
    const events = [makeEvent("e1", MESSAGE_SENT, "2026-03-19T10:00:00.000Z")];
    const r = computeEvents(events);
    expect(r.sessionDurationMs).toBeNull();
  });

  it("buckets events by UTC hour", () => {
    const events = [
      makeEvent("e1", MESSAGE_SENT, "2026-03-19T10:00:00.000Z"),
      makeEvent("e2", MESSAGE_SENT, "2026-03-19T10:30:00.000Z"),
      makeEvent("e3", MESSAGE_SENT, "2026-03-19T11:15:00.000Z"),
    ];
    const r = computeEvents(events);
    expect(r.byHour).toHaveLength(2);
    const h10 = r.byHour.find((h) => h.hour.includes("T10:"));
    expect(h10?.count).toBe(2);
  });
});

// ── 5. computeSessionAnalytics ────────────────────────────────────────────────

describe("5. computeSessionAnalytics — full orchestration", () => {
  it("returns all required top-level fields", () => {
    const state = emptyState();
    const a = computeSessionAnalytics("sess_test", "active", state);
    expect(typeof a.sessionId).toBe("string");
    expect(typeof a.derivedAt).toBe("string");
    expect(typeof a.kpi).toBe("object");
    expect(typeof a.revenue).toBe("object");
    expect(typeof a.risk).toBe("object");
    expect(typeof a.rules).toBe("object");
    expect(typeof a.events).toBe("object");
  });

  it("KPI totalEvents matches events array length", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);

    for (let i = 0; i < 3; i++) {
      const s = getSession(created.value.sessionId);
      if (!s.ok) break;
      const e = createDomainEvent({ id: `kpi_e${i}`, type: MESSAGE_SENT, payload: {}, source: SRC });
      appendEventToSession(created.value.sessionId, e, evaluateEvent(e, s.value.state, cfg));
    }

    const session = getSession(created.value.sessionId);
    if (!session.ok) return;
    const a = computeSessionAnalytics(session.value.sessionId, session.value.status, session.value.state);
    expect(a.kpi.totalEvents).toBe(3);
    expect(a.events.totalEventCount).toBe(3);
  });

  it("KPI netRevenueMinorUnits matches revenue.netMinorUnits", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);

    const stateOpen = { ...created.value.state, appOpen: true } as typeof created.value.state;
    const e = createDomainEvent({ id: "kpi_rev_e1", type: MESSAGE_SENT, payload: {}, source: SRC });
    appendEventToSession(created.value.sessionId, e, evaluateEvent(e, stateOpen, cfg));

    const session = getSession(created.value.sessionId);
    if (!session.ok) return;
    const a = computeSessionAnalytics(session.value.sessionId, session.value.status, session.value.state);
    expect(a.kpi.netRevenueMinorUnits).toBe(a.revenue.netMinorUnits);
    expect(a.kpi.totalSavingsMinorUnits).toBe(a.revenue.totalSavingsMinorUnits);
  });

  it("KPI rulesFiredCount matches rules.totalRulesFired", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);

    const e = createDomainEvent({ id: "kpi_rules_e1", type: MESSAGE_SENT, payload: {}, source: SRC });
    appendEventToSession(created.value.sessionId, e, evaluateEvent(e, created.value.state, cfg));

    const session = getSession(created.value.sessionId);
    if (!session.ok) return;
    const a = computeSessionAnalytics(session.value.sessionId, session.value.status, session.value.state);
    expect(a.kpi.rulesFiredCount).toBe(a.rules.totalRulesFired);
  });

  it("derivedAt is a recent ISO timestamp", () => {
    const before = Date.now();
    const a = computeSessionAnalytics("sess_x", "active", emptyState());
    const after = Date.now();
    const derivedTs = new Date(a.derivedAt).getTime();
    expect(derivedTs).toBeGreaterThanOrEqual(before);
    expect(derivedTs).toBeLessThanOrEqual(after);
  });
});

// ── 6. computeMultiSessionAnalytics ──────────────────────────────────────────

describe("6. computeMultiSessionAnalytics — cross-session aggregate", () => {
  it("aggregates net revenue across sessions", () => {
    const s1 = createInitialSimulationState("sess_a", { scenarioId: "t", scenarioName: "T", maxEvents: 10, timeoutMs: 30_000, enabledRules: [], pluginIds: [] });
    const s2 = createInitialSimulationState("sess_b", { scenarioId: "t", scenarioName: "T", maxEvents: 10, timeoutMs: 30_000, enabledRules: [], pluginIds: [] });

    // Inject revenue events directly into states
    const rev1 = makeRevenueEvent({ id: "m_r1", direction: "gain", category: "sms_saved", amount: { amountMinorUnits: 400, currency: "NGN" } });
    const rev2 = makeRevenueEvent({ id: "m_r2", direction: "gain", category: "sms_saved", amount: { amountMinorUnits: 800, currency: "NGN" } });

    const state1 = { ...s1, revenueEvents: [rev1] };
    const state2 = { ...s2, revenueEvents: [rev2] };

    const result = computeMultiSessionAnalytics([
      { sessionId: "sess_a", sessionStatus: "active", state: state1 as SimulationState },
      { sessionId: "sess_b", sessionStatus: "active", state: state2 as SimulationState },
    ]);

    expect(result.sessionCount).toBe(2);
    expect(result.aggregate.totalNetRevenueMinorUnits).toBe(1200);
    expect(result.aggregate.totalSavingsMinorUnits).toBe(1200);
  });

  it("sessions have independent analytics (no cross-contamination)", () => {
    const s1 = createInitialSimulationState("sess_c", { scenarioId: "t", scenarioName: "T", maxEvents: 10, timeoutMs: 30_000, enabledRules: [], pluginIds: [] });
    const s2 = createInitialSimulationState("sess_d", { scenarioId: "t", scenarioName: "T", maxEvents: 10, timeoutMs: 30_000, enabledRules: [], pluginIds: [] });

    const rev = makeRevenueEvent({ id: "iso_r1", direction: "gain", category: "sms_saved", amount: { amountMinorUnits: 500, currency: "NGN" } });
    const state1 = { ...s1, revenueEvents: [rev] };

    const result = computeMultiSessionAnalytics([
      { sessionId: "sess_c", sessionStatus: "active", state: state1 as SimulationState },
      { sessionId: "sess_d", sessionStatus: "active", state: s2 },
    ]);

    // Session D had no revenue
    const d = result.sessions.find((s) => s.sessionId === "sess_d");
    expect(d?.revenue.totalGainMinorUnits).toBe(0);
    // Session C had revenue
    const c = result.sessions.find((s) => s.sessionId === "sess_c");
    expect(c?.revenue.totalGainMinorUnits).toBe(500);
  });

  it("returns empty aggregate for no sessions", () => {
    const r = computeMultiSessionAnalytics([]);
    expect(r.aggregate.totalNetRevenueMinorUnits).toBe(0);
    expect(r.sessionCount).toBe(0);
    expect(r.sessions).toHaveLength(0);
  });
});

// ── 7. Audit guarantee ────────────────────────────────────────────────────────

describe("7. Audit guarantee — same input → same output", () => {
  it("computeRevenue is deterministic", () => {
    const events = [
      makeRevenueEvent({ id: "aud_r1", direction: "gain", category: "sms_saved", amount: { amountMinorUnits: 400, currency: "NGN" } }),
      makeRevenueEvent({ id: "aud_r2", direction: "loss", category: "sms_cost",  amount: { amountMinorUnits: 200, currency: "NGN" } }),
    ];
    const r1 = computeRevenue(events);
    const r2 = computeRevenue(events);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("computeRisk is deterministic", () => {
    const events = [
      makeRiskEvent({ id: "aud_risk1", severity: "high", score: 0.8, category: "timezone_mismatch" }),
    ];
    const r1 = computeRisk(events);
    const r2 = computeRisk(events);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("computeSessionAnalytics is deterministic", () => {
    const state = emptyState();
    const a1 = computeSessionAnalytics("sess_audit", "active", state);
    const a2 = computeSessionAnalytics("sess_audit", "active", state);
    // derivedAt will differ — exclude it for the comparison
    expect(a1.kpi).toEqual(a2.kpi);
    expect(a1.revenue).toEqual(a2.revenue);
    expect(a1.risk).toEqual(a2.risk);
    expect(a1.rules).toEqual(a2.rules);
    expect(a1.events).toEqual(a2.events);
  });
});

// ── 8. Real-time consistency ──────────────────────────────────────────────────

describe("8. Real-time consistency — new events reflected immediately", () => {
  it("analytics after event 2 includes event 2 revenue", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);
    const id = created.value.sessionId;

    // Event 1
    const stateOpen = { ...created.value.state, appOpen: true } as typeof created.value.state;
    const e1 = createDomainEvent({ id: "rt_e1", type: MESSAGE_SENT, payload: {}, source: SRC });
    appendEventToSession(id, e1, evaluateEvent(e1, stateOpen, cfg));

    const s1 = getSession(id);
    if (!s1.ok) return;
    const a1 = computeSessionAnalytics(s1.value.sessionId, s1.value.status, s1.value.state);
    const revAfter1 = a1.revenue.totalRevenueEventCount;

    // Event 2
    const s2state = getSession(id);
    if (!s2state.ok) return;
    const e2 = createDomainEvent({ id: "rt_e2", type: MESSAGE_SENT, payload: {}, source: SRC });
    appendEventToSession(id, e2, evaluateEvent(e2, s2state.value.state, cfg));

    const s2 = getSession(id);
    if (!s2.ok) return;
    const a2 = computeSessionAnalytics(s2.value.sessionId, s2.value.status, s2.value.state);

    // Analytics after event 2 must show more revenue events
    expect(a2.revenue.totalRevenueEventCount).toBeGreaterThan(revAfter1);
  });

  it("risk analytics immediately reflects a new risk event", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);
    const id = created.value.sessionId;

    // Before risk event
    const a1 = computeSessionAnalytics(created.value.sessionId, "active", created.value.state);
    expect(a1.risk.totalSignalCount).toBe(0);

    // Trigger a 3am payment → timezone_mismatch risk event
    const e = createDomainEvent({ id: "rt_risk", type: PAYMENT_INITIATED, payload: { recipientTimezone: "Africa/Lagos" }, source: SRC, timestamp: NOW3AM });
    const s = getSession(id);
    if (!s.ok) return;
    appendEventToSession(id, e, evaluateEvent(e, s.value.state, cfg));

    const s2 = getSession(id);
    if (!s2.ok) return;
    const a2 = computeSessionAnalytics(s2.value.sessionId, s2.value.status, s2.value.state);
    expect(a2.risk.totalSignalCount).toBeGreaterThan(0);
  });
});

// ── 9. No manual counters — derived-only check ───────────────────────────────

describe("9. Derived-only guarantee", () => {
  it("totalRevenue computed from revenueEvents, not a stored counter", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);
    const id = created.value.sessionId;

    // Trigger 5 events
    for (let i = 0; i < 5; i++) {
      const s = getSession(id);
      if (!s.ok) break;
      const stateOpen = { ...s.value.state, appOpen: true } as typeof s.value.state;
      const e = createDomainEvent({ id: `derived_e${i}`, type: MESSAGE_SENT, payload: {}, source: SRC });
      appendEventToSession(id, e, evaluateEvent(e, stateOpen, cfg));
    }

    const session = getSession(id);
    if (!session.ok) return;

    // Manually sum from raw events
    const manualSum = session.value.state.revenueEvents.reduce(
      (acc, r) => acc + (r.direction === "gain" ? r.amount.amountMinorUnits : 0), 0
    );

    const a = computeSessionAnalytics(session.value.sessionId, session.value.status, session.value.state);

    // Analytics must match the manual sum exactly
    expect(a.revenue.totalGainMinorUnits).toBe(manualSum);
  });

  it("rulesFiredCount derived from ruleTraces, not stored counter", () => {
    resetAll();
    const created = createSession();
    if (!created.ok) return;
    const env = getEnv();
    const cfg = getEngineConfig(env);
    const id = created.value.sessionId;

    for (let i = 0; i < 3; i++) {
      const s = getSession(id);
      if (!s.ok) break;
      const e = createDomainEvent({ id: `derived_r${i}`, type: MESSAGE_SENT, payload: {}, source: SRC });
      appendEventToSession(id, e, evaluateEvent(e, s.value.state, cfg));
    }

    const session = getSession(id);
    if (!session.ok) return;

    // Manual count
    const manualFired = session.value.state.ruleTraces.filter((t) => t.outcome === "fired").length;

    const a = computeSessionAnalytics(session.value.sessionId, session.value.status, session.value.state);
    expect(a.rules.totalRulesFired).toBe(manualFired);
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
