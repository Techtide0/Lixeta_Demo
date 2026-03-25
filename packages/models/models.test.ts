/**
 * @file models.test.ts
 * @description Full coverage for the @models package.
 *
 * Tests verify:
 *   1. EventType registry completeness and guards
 *   2. DomainEvent validation
 *   3. Factory function correctness
 *   4. Utility types (Result, assertNever)
 *   5. No `any` escapes — every assertion uses typed inputs
 */

import { describe, it, expect } from "vitest";

import {
  // Event types
  ALL_EVENT_TYPES,
  isEventType,
  MESSAGE_SENT,
  PAYMENT_FAILED,
  RULE_FIRED,
  SIMULATION_COMPLETED,
  RISK_FLAG_RAISED,
  REVENUE_EARNED,
  // Validators
  isDomainEvent,
  assertDomainEvent,
  ModelValidationError,
  isISOTimestamp,
  isUnitScore,
  assertUnitScore,
  isNonEmptyString,
  // Factories
  createDomainEvent,
  createEventSource,
  createInitialSimulationState,
  createMoney,
  createRevenueEvent,
  createRiskEvent,
  createRuleTrace,
  createDecisionResult,
  // Result helpers
  ok,
  err,
  isOk,
  isErr,
  assertNever,
} from "./src/index.js";

// ---------------------------------------------------------------------------
// EventType Registry
// ---------------------------------------------------------------------------

describe("EventType registry", () => {
  it("ALL_EVENT_TYPES is non-empty", () => {
    expect(ALL_EVENT_TYPES.length).toBeGreaterThan(0);
  });

  it("isEventType accepts known values", () => {
    expect(isEventType(MESSAGE_SENT)).toBe(true);
    expect(isEventType(PAYMENT_FAILED)).toBe(true);
    expect(isEventType(RULE_FIRED)).toBe(true);
    expect(isEventType(SIMULATION_COMPLETED)).toBe(true);
    expect(isEventType(RISK_FLAG_RAISED)).toBe(true);
    expect(isEventType(REVENUE_EARNED)).toBe(true);
  });

  it("isEventType rejects unknown strings", () => {
    expect(isEventType("unknown.event")).toBe(false);
    expect(isEventType("")).toBe(false);
    expect(isEventType(null)).toBe(false);
    expect(isEventType(42)).toBe(false);
    expect(isEventType(undefined)).toBe(false);
  });

  it("ALL_EVENT_TYPES contains no duplicates", () => {
    const set = new Set(ALL_EVENT_TYPES);
    expect(set.size).toBe(ALL_EVENT_TYPES.length);
  });
});

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

describe("isISOTimestamp", () => {
  it("accepts valid ISO 8601 strings", () => {
    expect(isISOTimestamp("2024-01-15T10:30:00.000Z")).toBe(true);
    expect(isISOTimestamp(new Date().toISOString())).toBe(true);
  });

  it("rejects invalid strings", () => {
    expect(isISOTimestamp("2024-01-15")).toBe(false); // no T
    expect(isISOTimestamp("not-a-date")).toBe(false);
    expect(isISOTimestamp("")).toBe(false);
    expect(isISOTimestamp(null)).toBe(false);
    expect(isISOTimestamp(1234567890)).toBe(false);
  });
});

describe("isUnitScore", () => {
  it("accepts values in [0, 1]", () => {
    expect(isUnitScore(0)).toBe(true);
    expect(isUnitScore(1)).toBe(true);
    expect(isUnitScore(0.5)).toBe(true);
    expect(isUnitScore(0.999)).toBe(true);
  });

  it("rejects out-of-range values", () => {
    expect(isUnitScore(-0.01)).toBe(false);
    expect(isUnitScore(1.01)).toBe(false);
    expect(isUnitScore(NaN)).toBe(false);
    expect(isUnitScore("0.5")).toBe(false);
  });
});

describe("assertUnitScore", () => {
  it("does not throw for valid scores", () => {
    expect(() => assertUnitScore(0.75)).not.toThrow();
  });

  it("throws ModelValidationError for invalid scores", () => {
    expect(() => assertUnitScore(2, "confidence")).toThrow(ModelValidationError);
  });
});

describe("isDomainEvent / assertDomainEvent", () => {
  const validEvent = {
    id: "evt_001",
    type: MESSAGE_SENT,
    timestamp: new Date().toISOString(),
    payload: { recipientId: "user_1", body: "Hello" },
    source: { id: "plugin_sms", name: "SMS Plugin", version: "1.0.0", channel: "sms" },
    metadata: { createdAt: new Date().toISOString() },
    severity: "info",
    priority: "normal",
  };

  it("accepts a valid DomainEvent-shaped object", () => {
    expect(isDomainEvent(validEvent)).toBe(true);
  });

  it("rejects missing required fields", () => {
    const { id: _omitted, ...withoutId } = validEvent;
    expect(isDomainEvent(withoutId)).toBe(false);
  });

  it("rejects invalid event type", () => {
    expect(isDomainEvent({ ...validEvent, type: "not.a.type" })).toBe(false);
  });

  it("rejects invalid severity", () => {
    expect(isDomainEvent({ ...validEvent, severity: "catastrophic" })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isDomainEvent(null)).toBe(false);
    expect(isDomainEvent("string")).toBe(false);
    expect(isDomainEvent([])).toBe(false);
  });

  it("assertDomainEvent throws ModelValidationError with field info", () => {
    try {
      assertDomainEvent({ ...validEvent, id: "" });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ModelValidationError);
      expect((e as ModelValidationError).field).toBe("id");
    }
  });
});

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

describe("createDomainEvent", () => {
  it("creates a fully populated DomainEvent", () => {
    const source = createEventSource({ id: "test_plugin", name: "Test Plugin" });
    const event = createDomainEvent({
      id: "evt_test_1",
      type: MESSAGE_SENT,
      payload: { body: "test", recipientId: "user_42" },
      source,
    });

    expect(event.id).toBe("evt_test_1");
    expect(event.type).toBe(MESSAGE_SENT);
    expect(event.severity).toBe("info");
    expect(event.priority).toBe("normal");
    expect(isISOTimestamp(event.timestamp)).toBe(true);
    expect(isISOTimestamp(event.metadata.createdAt)).toBe(true);
  });

  it("respects overridden severity and priority", () => {
    const source = createEventSource({ id: "s", name: "S" });
    const event = createDomainEvent({
      id: "evt_2",
      type: PAYMENT_FAILED,
      payload: { transactionId: "tx_1" },
      source,
      severity: "critical",
      priority: "urgent",
    });

    expect(event.severity).toBe("critical");
    expect(event.priority).toBe("urgent");
  });
});

describe("createInitialSimulationState", () => {
  it("creates an idle state with correct defaults", () => {
    const config = {
      scenarioId: "sc_1",
      scenarioName: "Test Scenario",
      maxEvents: 1000,
      timeoutMs: 30_000,
      enabledRules: ["rule_1", "rule_2"],
      pluginIds: ["sms_plugin"],
    };

    const state = createInitialSimulationState("sim_001", config);

    expect(state.id).toBe("sim_001");
    expect(state.status).toBe("idle");
    expect(state.events).toHaveLength(0);
    expect(state.revenueEvents).toHaveLength(0);
    expect(state.riskEvents).toHaveLength(0);
    expect(state.ruleTraces).toHaveLength(0);
    expect(state.lastError).toBeNull();
    expect(state.counters.totalEventsProcessed).toBe(0);
  });
});

describe("createMoney", () => {
  it("normalises currency to uppercase", () => {
    const m = createMoney(50000, "ngn");
    expect(m.currency).toBe("NGN");
    expect(m.amountMinorUnits).toBe(50000);
  });
});

describe("createRevenueEvent", () => {
  it("creates a RevenueEvent with correct defaults", () => {
    const rev = createRevenueEvent({
      id: "rev_1",
      triggeringEventId: "evt_1",
      triggeringEventType: MESSAGE_SENT,
      category: "sms_saved",
      direction: "gain",
      amount: createMoney(300, "NGN"),
      description: "SMS avoided by using push notification",
    });

    expect(rev.triggeringRuleId).toBeNull();
    expect(rev.triggeringRuleName).toBeNull();
    expect(isISOTimestamp(rev.recordedAt)).toBe(true);
    expect(rev.metadata).toEqual({});
  });
});

describe("createRiskEvent", () => {
  it("creates a RiskEvent with status 'open'", () => {
    const risk = createRiskEvent({
      id: "risk_1",
      triggeringEventId: "evt_2",
      triggeringEventType: PAYMENT_FAILED,
      category: "timezone_mismatch",
      severity: "high",
      score: 0.82,
      description: "Transaction at 3am local time",
      evidence: {
        type: "timezone",
        recipientTimezone: "Africa/Lagos",
        transactionLocalHour: 3,
        normalWindowStart: 7,
        normalWindowEnd: 22,
      },
    });

    expect(risk.status).toBe("open");
    expect(risk.score).toBe(0.82);
    expect(isISOTimestamp(risk.detectedAt)).toBe(true);
  });
});

describe("createRuleTrace", () => {
  it("creates a RuleTrace with empty contextSnapshot by default", () => {
    const trace = createRuleTrace({
      traceId: "trace_1",
      ruleId: "rule_tz",
      ruleName: "Timezone Check",
      ruleVersion: "2.1.0",
      triggeringEventId: "evt_3",
      triggeringEventType: PAYMENT_FAILED,
      executionTimeMs: 4,
      outcome: "fired",
      explanation: "Transaction hour 3 is outside normal window 7–22",
      conditions: [
        {
          description: "transactionLocalHour < normalWindowStart",
          actualValue: 3,
          expectedValue: 7,
          passed: true,
        },
      ],
      actions: [
        {
          actionType: "flag_transaction",
          description: "Flag for manual review",
          executed: true,
        },
      ],
    });

    expect(trace.outcome).toBe("fired");
    expect(trace.contextSnapshot).toEqual({});
    expect(isISOTimestamp(trace.evaluatedAt)).toBe(true);
  });
});

describe("createDecisionResult", () => {
  it("creates a DecisionResult with empty arrays by default", () => {
    const decision = createDecisionResult({
      decisionId: "dec_1",
      sourceEventId: "evt_4",
      sourceEventType: RULE_FIRED,
      totalExecutionTimeMs: 12,
      verdict: "flag",
      reason: "Timezone mismatch detected",
      confidence: 0.9,
    });

    expect(decision.verdict).toBe("flag");
    expect(decision.appliedRuleTraces).toHaveLength(0);
    expect(decision.appliedActions).toHaveLength(0);
    expect(isISOTimestamp(decision.decidedAt)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

describe("Result helpers", () => {
  it("ok wraps a value", () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe(42);
  });

  it("err wraps an error", () => {
    const r = err(new Error("oops"));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.message).toBe("oops");
  });

  it("ok result fails isErr check", () => {
    expect(isErr(ok("hello"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assertNever
// ---------------------------------------------------------------------------

describe("assertNever", () => {
  it("throws when called at runtime", () => {
    expect(() => assertNever("impossible" as never)).toThrow();
  });

  it("includes the unexpected value in the error message", () => {
    try {
      assertNever("surprise" as never);
    } catch (e) {
      expect((e as Error).message).toContain("surprise");
    }
  });
});

// ---------------------------------------------------------------------------
// isNonEmptyString
// ---------------------------------------------------------------------------

describe("isNonEmptyString", () => {
  it("returns true for non-blank strings", () => {
    expect(isNonEmptyString("hello")).toBe(true);
    expect(isNonEmptyString(" a ")).toBe(true);
  });

  it("returns false for blank or non-string values", () => {
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString("   ")).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(0)).toBe(false);
  });
});
