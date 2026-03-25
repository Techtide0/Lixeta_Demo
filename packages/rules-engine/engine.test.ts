/**
 * @file engine.test.ts
 * @description Comprehensive test suite for rules-engine Stage 2.
 *
 * Coverage:
 *   1.  Security guard — size, source allowlist, channel, sanitisation
 *   2.  Smart Notification rule — fires (app open), skips (app closed)
 *   3.  Timezone Risk rule — flags abnormal hours, passes normal hours
 *   4.  evaluateEvent full pipeline — decision shape, revenue, risk, traces
 *   5.  Verdict merge priority logic
 *   6.  Rule registry — duplicate ID, freeze, enabled-set filtering
 *   7.  ID generator — collision resistance, prefix format
 *   8.  Error isolation — throwing rule produces error trace, not crash
 *   9.  Validation rejection — malformed event returns error verdict
 *  10.  Budget / limit enforcement
 */

import {
  evaluateEvent,
  buildEngineConfig,
  registerBuiltinRules,
  registerRule,
  freezeRegistry,
  isRegistryFrozen,
  listRegisteredRuleIds,
  getEnabledRules,
  runSecurityGuard,
  mergeVerdicts,
  allowContribution,
  blockContribution,
  flagContribution,
  noOpinion,
  generateTraceId,
  generateDecisionId,
  SMART_NOTIFICATION_RULE_ID,
  TIMEZONE_RISK_RULE_ID,
  ALL_BUILTIN_RULE_IDS,
  smartNotificationRule,
  timezoneRiskRule,
  _resetRegistryForTesting,
  _resetBuiltinRegistrationFlag,
  _resetCounterForTesting,
} from "./src/index.ts";

import type {
  EngineConfig,
  EngineEvaluationOutput,
} from "./src/index.ts";

import type {
  DomainEvent,
  SimulationState,
} from "../models/src/index.ts";

import {
  MESSAGE_SENT,
  PAYMENT_INITIATED,
  createInitialSimulationState,
  createEventSource,
  createDomainEvent,
} from "../models/src/index.ts";

// ---------------------------------------------------------------------------
// Minimal test harness (no external deps)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function describe(name: string, fn: () => void): void {
  console.log(`\n  ${name}`);
  fn();
}

function it(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`    ✓ ${name}`);
    passed++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`    ✗ ${name}`);
    console.log(`      └─ ${msg}`);
    failed++;
    failures.push(`${name}: ${msg}`);
  }
}

function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected)
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toEqual(expected: unknown) {
      if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toBeGreaterThan(n: number) {
      if (typeof actual !== "number" || actual <= n)
        throw new Error(`Expected > ${n}, got ${actual}`);
    },
    toBeGreaterThanOrEqual(n: number) {
      if (typeof actual !== "number" || actual < n)
        throw new Error(`Expected >= ${n}, got ${actual}`);
    },
    toHaveLength(n: number) {
      const len = (actual as unknown[]).length;
      if (len !== n) throw new Error(`Expected length ${n}, got ${len}`);
    },
    toBeNull() {
      if (actual !== null) throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
    },
    toBeUndefined() {
      if (actual !== undefined) throw new Error(`Expected undefined, got ${JSON.stringify(actual)}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy, got ${JSON.stringify(actual)}`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy, got ${JSON.stringify(actual)}`);
    },
    toContain(sub: string) {
      if (typeof actual !== "string" || !actual.includes(sub))
        throw new Error(`Expected "${actual}" to contain "${sub}"`);
    },
    toMatch(pattern: RegExp) {
      if (typeof actual !== "string" || !pattern.test(actual))
        throw new Error(`Expected "${actual}" to match ${pattern}`);
    },
    toBeInstanceOf(cls: new (...a: unknown[]) => unknown) {
      if (!(actual instanceof cls)) throw new Error(`Expected instance of ${cls.name}`);
    },
    not: {
      toBe(v: unknown) {
        if (actual === v) throw new Error(`Expected NOT ${JSON.stringify(v)}`);
      },
      toBeUndefined() {
        if (actual === undefined) throw new Error(`Expected defined value`);
      },
      toHaveLength(n: number) {
        const len = (actual as unknown[]).length;
        if (len === n) throw new Error(`Expected length NOT to be ${n}`);
      },
    },
  };
}

function expectToThrow(fn: () => void, msgFragment?: string): void {
  try {
    fn();
    throw new Error("Expected function to throw but it did not");
  } catch (e) {
    if (msgFragment) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes(msgFragment))
        throw new Error(`Expected error containing "${msgFragment}", got: "${msg}"`);
    }
  }
}

function expectNotToThrow(fn: () => void): void {
  fn();
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_SOURCE = createEventSource({
  id: "test-plugin",
  name: "Test Plugin",
  version: "1.0.0",
  channel: "sms",
});

function makeMessageSentEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return createDomainEvent({
    id: "evt_msg_001",
    type: MESSAGE_SENT,
    payload: {
      recipientId: "user_42",
      senderId: "system",
      body: "Your OTP is 1234",
      charCount: 16,
      segmentCount: 1,
    },
    source: TEST_SOURCE,
    ...overrides,
  });
}

function makePaymentInitiatedEvent(
  timezone = "Africa/Lagos",
  timestamp?: string
): DomainEvent {
  return createDomainEvent({
    id: "evt_pay_001",
    type: PAYMENT_INITIATED,
    payload: {
      transactionId: "tx_001",
      amount: 500000,
      currency: "NGN",
      payerId: "user_1",
      payeeId: "merchant_1",
      reference: "REF-001",
      recipientTimezone: timezone,
    },
    source: { ...TEST_SOURCE, channel: "api" },
    ...(timestamp !== undefined ? { timestamp } : {}),
  });
}

function makeBaseState(appOpen = false): SimulationState {
  const base = createInitialSimulationState("sim_test_001", {
    scenarioId: "test_scenario",
    scenarioName: "Test",
    maxEvents: 100,
    timeoutMs: 30_000,
    enabledRules: [...ALL_BUILTIN_RULE_IDS],
    pluginIds: ["test-plugin"],
  });
  // Inject appOpen into the state via the record escape hatch
  return { ...base, ...({ appOpen } as Record<string, unknown>) } as SimulationState;
}

function makeConfig(
  overrides: Partial<EngineConfig> = {},
  trustedSourceIds: string[] | null = null
): EngineConfig {
  return buildEngineConfig({
    engineId: "test-engine",
    engineVersion: "1.0.0",
    enabledRuleIds: [...ALL_BUILTIN_RULE_IDS],
    security: {
      trustedSourceIds,
      allowedChannels: null,
      sanitizePayloads: true,
      capturePayloadSnapshot: false,
      maxTraceRecords: 100,
    },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Suite setup — reset registry before every suite
// ---------------------------------------------------------------------------

function setupRegistry(): void {
  _resetRegistryForTesting();
  _resetBuiltinRegistrationFlag();
  registerBuiltinRules();
}

// ---------------------------------------------------------------------------
// 1. Security Guard
// ---------------------------------------------------------------------------

describe("Security Guard", () => {
  const cfg = makeConfig();

  it("passes a valid event through", () => {
    const event = makeMessageSentEvent();
    const result = runSecurityGuard(event, cfg);
    expect(result.passed).toBe(true);
  });

  it("rejects oversized payloads", () => {
    const bigPayload = { data: "x".repeat(40_000) };
    const event = makeMessageSentEvent({ payload: bigPayload });
    const result = runSecurityGuard(event, cfg);
    expect(result.passed).toBe(false);
    if (!result.passed) expect(result.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects events from untrusted sources", () => {
    const strictCfg = makeConfig({}, ["trusted-plugin-only"]);
    const event = makeMessageSentEvent();
    const result = runSecurityGuard(event, strictCfg);
    expect(result.passed).toBe(false);
    if (!result.passed) expect(result.code).toBe("UNTRUSTED_SOURCE");
  });

  it("accepts events from a trusted source", () => {
    const strictCfg = makeConfig({}, ["test-plugin"]);
    const event = makeMessageSentEvent();
    const result = runSecurityGuard(event, strictCfg);
    expect(result.passed).toBe(true);
  });

  it("rejects events on disallowed channels", () => {
    const channelCfg = makeConfig({
      security: {
        trustedSourceIds: null,
        allowedChannels: ["api", "push"],
        sanitizePayloads: true,
        capturePayloadSnapshot: false,
        maxTraceRecords: 100,
      },
    });
    const event = makeMessageSentEvent(); // source.channel is "sms"
    const result = runSecurityGuard(event, channelCfg);
    expect(result.passed).toBe(false);
    if (!result.passed) expect(result.code).toBe("DISALLOWED_CHANNEL");
  });

  it("strips __proto__ keys from payload", () => {
    const event = makeMessageSentEvent({
      payload: {
        recipientId: "user_1",
        __proto__: { admin: true },
        __hidden: "bad value",
        legitimate: "value",
      },
    });
    const result = runSecurityGuard(event, cfg);
    expect(result.passed).toBe(true);
    if (result.passed) {
      expect((result.sanitizedEvent.payload as Record<string, unknown>)["__hidden"]).toBeUndefined();
      expect((result.sanitizedEvent.payload as Record<string, unknown>)["legitimate"]).toBe("value");
    }
  });

  it("preserves clean payloads unchanged", () => {
    const event = makeMessageSentEvent();
    const result = runSecurityGuard(event, cfg);
    expect(result.passed).toBe(true);
    if (result.passed) {
      expect((result.sanitizedEvent.payload as Record<string, unknown>)["recipientId"]).toBe("user_42");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Smart Notification Rule (unit)
// ---------------------------------------------------------------------------

describe("Smart Notification Rule — unit", () => {
  it("applies() returns true for MESSAGE_SENT", () => {
    setupRegistry();
    const cfg = makeConfig();
    const event = makeMessageSentEvent();
    const state = makeBaseState(false);
    const ctx = makeMinimalContext(event, state, cfg);
    expect(smartNotificationRule.applies(ctx)).toBe(true);
  });

  it("applies() returns false for PAYMENT_INITIATED", () => {
    setupRegistry();
    const cfg = makeConfig();
    const event = makePaymentInitiatedEvent();
    const state = makeBaseState(false);
    const ctx = makeMinimalContext(event, state, cfg);
    expect(smartNotificationRule.applies(ctx)).toBe(false);
  });

  it("evaluate() fires and emits revenue gain when app is open", () => {
    setupRegistry();
    const cfg = makeConfig();
    const event = makeMessageSentEvent();
    const state = makeBaseState(true); // app open
    const revenueCapture: unknown[] = [];
    const ctx = makeMinimalContext(event, state, cfg, revenueCapture);

    const result = smartNotificationRule.evaluate(ctx);

    expect(result.trace.outcome).toBe("fired");
    expect(result.verdictContribution.type).toBe("allow");
    expect(revenueCapture).toHaveLength(1);

    const rev = revenueCapture[0] as Record<string, unknown>;
    expect(rev["category"]).toBe("sms_saved");
    expect(rev["direction"]).toBe("gain");
    expect((rev["amount"] as Record<string, unknown>)["amountMinorUnits"]).toBe(400);
  });

  it("evaluate() records SMS cost (loss) when app is closed", () => {
    setupRegistry();
    const cfg = makeConfig();
    const event = makeMessageSentEvent();
    const state = makeBaseState(false); // app closed
    const revenueCapture: unknown[] = [];
    const ctx = makeMinimalContext(event, state, cfg, revenueCapture);

    const result = smartNotificationRule.evaluate(ctx);

    expect(result.trace.outcome).toBe("no_match");
    expect(result.verdictContribution.type).toBe("no_opinion");
    expect(revenueCapture).toHaveLength(1);

    const rev = revenueCapture[0] as Record<string, unknown>;
    expect(rev["category"]).toBe("sms_cost");
    expect(rev["direction"]).toBe("loss");
  });

  it("trace contains all required fields", () => {
    setupRegistry();
    const cfg = makeConfig();
    const event = makeMessageSentEvent();
    const state = makeBaseState(true);
    const ctx = makeMinimalContext(event, state, cfg);
    const result = smartNotificationRule.evaluate(ctx);
    const trace = result.trace;

    expect(trace.ruleId).toBe(SMART_NOTIFICATION_RULE_ID);
    expect(trace.ruleName).toBe("Smart Notification");
    expect(trace.triggeringEventId).toBe(event.id);
    expect(trace.triggeringEventType).toBe(MESSAGE_SENT);
    expect(trace.conditions).toHaveLength(2);
    expect(trace.actions).toHaveLength(1);
    expect(typeof trace.evaluatedAt).toBe("string");
  });

  it("explanation mentions suppression when app is open", () => {
    setupRegistry();
    const cfg = makeConfig();
    const event = makeMessageSentEvent();
    const state = makeBaseState(true);
    const ctx = makeMinimalContext(event, state, cfg);
    const result = smartNotificationRule.evaluate(ctx);
    expect(result.trace.explanation).toContain("suppressed");
  });
});

// ---------------------------------------------------------------------------
// 3. Timezone Risk Rule (unit)
// ---------------------------------------------------------------------------

describe("Timezone Risk Rule — unit", () => {
  it("applies() returns true for PAYMENT_INITIATED", () => {
    setupRegistry();
    const cfg = makeConfig();
    const event = makePaymentInitiatedEvent();
    const state = makeBaseState();
    const ctx = makeMinimalContext(event, state, cfg);
    expect(timezoneRiskRule.applies(ctx)).toBe(true);
  });

  it("applies() returns false for MESSAGE_SENT", () => {
    setupRegistry();
    const cfg = makeConfig();
    const event = makeMessageSentEvent();
    const state = makeBaseState();
    const ctx = makeMinimalContext(event, state, cfg);
    expect(timezoneRiskRule.applies(ctx)).toBe(false);
  });

  it("emits risk signal and flags when payment is at 3am local", () => {
    setupRegistry();
    const cfg = makeConfig();
    // Construct a timestamp that is ~03:00 in Africa/Lagos (UTC+1 → UTC 02:xx)
    const abnormalTs = "2026-03-19T02:30:00.000Z"; // 03:30 Lagos time
    const event = makePaymentInitiatedEvent("Africa/Lagos", abnormalTs);
    const state = makeBaseState();
    const riskCapture: unknown[] = [];
    const ctx = makeMinimalContext(event, state, cfg, [], riskCapture);

    const result = timezoneRiskRule.evaluate(ctx);

    expect(result.trace.outcome).toBe("fired");
    expect(result.verdictContribution.type).toBe("flag");
    expect(riskCapture).toHaveLength(1);

    const risk = riskCapture[0] as Record<string, unknown>;
    expect(risk["category"]).toBe("timezone_mismatch");
    expect(risk["severity"]).toBe("high");
    const score = risk["score"] as number;
    expect(score).toBeGreaterThan(0);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("allows and emits no risk when payment is at 10am local", () => {
    setupRegistry();
    const cfg = makeConfig();
    // 09:00 UTC → 10:00 Lagos (UTC+1)
    const normalTs = "2026-03-19T09:00:00.000Z";
    const event = makePaymentInitiatedEvent("Africa/Lagos", normalTs);
    const state = makeBaseState();
    const riskCapture: unknown[] = [];
    const ctx = makeMinimalContext(event, state, cfg, [], riskCapture);

    const result = timezoneRiskRule.evaluate(ctx);

    expect(result.trace.outcome).toBe("no_match");
    expect(result.verdictContribution.type).toBe("allow");
    expect(riskCapture).toHaveLength(0);
  });

  it("trace contains condition breakdown", () => {
    setupRegistry();
    const cfg = makeConfig();
    const ts = "2026-03-19T02:30:00.000Z";
    const event = makePaymentInitiatedEvent("Africa/Lagos", ts);
    const state = makeBaseState();
    const ctx = makeMinimalContext(event, state, cfg);
    const result = timezoneRiskRule.evaluate(ctx);

    expect(result.trace.conditions.length).toBeGreaterThan(1);
    const tz = result.trace.conditions[1];
    expect(tz).not.toBeUndefined();
    if (tz !== undefined) expect(tz.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. evaluateEvent — full pipeline
// ---------------------------------------------------------------------------

describe("evaluateEvent — full pipeline", () => {
  it("returns well-formed EngineEvaluationOutput", () => {
    setupRegistry();
    const cfg = makeConfig();
    const event = makeMessageSentEvent();
    const state = makeBaseState(true);

    const output = evaluateEvent(event, state, cfg);

    expect(output.decision.verdict).toBe("allow");
    expect(output.decision.decisionId).toMatch(/^dec_/);
    expect(output.decision.sourceEventId).toBe(event.id);
    expect(output.decision.sourceEventType).toBe(MESSAGE_SENT);
    expect(typeof output.decision.totalExecutionTimeMs).toBe("number");
    expect(output.traceTruncated).toBe(false);
  });

  it("produces revenue event when app is open (MESSAGE_SENT)", () => {
    setupRegistry();
    const cfg = makeConfig();
    const event = makeMessageSentEvent();
    const state = makeBaseState(true);

    const output = evaluateEvent(event, state, cfg);

    expect(output.revenueEvents).toHaveLength(1);
    expect(output.revenueEvents[0]?.category).toBe("sms_saved");
    expect(output.revenueEvents[0]?.direction).toBe("gain");
    expect(output.revenueEvents[0]?.amount.amountMinorUnits).toBe(400);
  });

  it("produces sms_cost revenue when app is closed", () => {
    setupRegistry();
    const cfg = makeConfig();
    const event = makeMessageSentEvent();
    const state = makeBaseState(false);

    const output = evaluateEvent(event, state, cfg);

    expect(output.revenueEvents).toHaveLength(1);
    expect(output.revenueEvents[0]?.category).toBe("sms_cost");
    expect(output.revenueEvents[0]?.direction).toBe("loss");
  });

  it("produces risk event for 3am payment", () => {
    setupRegistry();
    const cfg = makeConfig();
    const ts = "2026-03-19T02:30:00.000Z"; // 3:30am Lagos
    const event = makePaymentInitiatedEvent("Africa/Lagos", ts);
    const state = makeBaseState();

    const output = evaluateEvent(event, state, cfg);

    expect(output.decision.verdict).toBe("flag");
    expect(output.riskEvents).toHaveLength(1);
    expect(output.riskEvents[0]?.category).toBe("timezone_mismatch");
    expect(output.riskEvents[0]?.id).toMatch(/^risk_/);
  });

  it("populates ruleTraces for every rule that ran", () => {
    setupRegistry();
    const cfg = makeConfig();
    const event = makeMessageSentEvent();
    const state = makeBaseState(true);

    const output = evaluateEvent(event, state, cfg);

    // Smart notification fires; timezone risk is skipped (wrong event type)
    expect(output.ruleTraces.length).toBeGreaterThan(0);
    const smartTrace = output.ruleTraces.find((t) => t.ruleId === SMART_NOTIFICATION_RULE_ID);
    expect(smartTrace).not.toBeUndefined();
    expect(smartTrace?.outcome).toBe("fired");
  });

  it("populates appliedRuleTraces summaries on decision", () => {
    setupRegistry();
    const cfg = makeConfig();
    const event = makeMessageSentEvent();
    const state = makeBaseState(true);
    const output = evaluateEvent(event, state, cfg);

    expect(output.decision.appliedRuleTraces.length).toBeGreaterThan(0);
    const summary = output.decision.appliedRuleTraces[0];
    expect(summary).not.toBeUndefined();
    if (summary !== undefined) {
      expect(typeof summary.traceId).toBe("string");
      expect(typeof summary.explanation).toBe("string");
    }
  });

  it("confidence is 1.0 when all rules succeed", () => {
    setupRegistry();
    const cfg = makeConfig();
    const event = makeMessageSentEvent();
    const state = makeBaseState(true);
    const output = evaluateEvent(event, state, cfg);
    expect(output.decision.confidence).toBe(1.0);
  });

  it("returns error verdict for a non-DomainEvent input", () => {
    setupRegistry();
    const cfg = makeConfig();
    const state = makeBaseState();

    const output = evaluateEvent({ completely: "wrong" }, state, cfg);

    expect(output.decision.verdict).toBe("error");
    expect(output.decision.engineError).not.toBeUndefined();
    expect(output.revenueEvents).toHaveLength(0);
    expect(output.ruleTraces).toHaveLength(0);
  });

  it("returns block verdict for untrusted source", () => {
    setupRegistry();
    const cfg = makeConfig({}, ["only-this-source"]);
    const event = makeMessageSentEvent(); // source.id = "test-plugin"
    const state = makeBaseState();

    const output = evaluateEvent(event, state, cfg);

    expect(output.decision.verdict).toBe("block");
    expect(output.revenueEvents).toHaveLength(0);
    expect(output.ruleTraces).toHaveLength(0);
  });

  it("runs only enabled rules — skips disabled ones", () => {
    setupRegistry();
    // Only enable smart-notification, not timezone-risk
    const cfg = buildEngineConfig({
      engineId: "test",
      engineVersion: "1.0.0",
      enabledRuleIds: [SMART_NOTIFICATION_RULE_ID],
      security: {
        trustedSourceIds: null,
        allowedChannels: null,
        sanitizePayloads: true,
        capturePayloadSnapshot: false,
        maxTraceRecords: 100,
      },
    });
    const event = makeMessageSentEvent();
    const state = makeBaseState(true);
    const output = evaluateEvent(event, state, cfg);

    const tzTrace = output.ruleTraces.find((t) => t.ruleId === TIMEZONE_RISK_RULE_ID);
    expect(tzTrace).toBeUndefined();
  });

  it("assigns IDs with correct prefixes on all outputs", () => {
    setupRegistry();
    const cfg = makeConfig();
    const ts = "2026-03-19T02:30:00.000Z";
    const event = makePaymentInitiatedEvent("Africa/Lagos", ts);
    const state = makeBaseState();
    const output = evaluateEvent(event, state, cfg);

    expect(output.decision.decisionId).toMatch(/^dec_/);
    if (output.riskEvents.length > 0) {
      expect(output.riskEvents[0]?.id).toMatch(/^risk_/);
    }
    if (output.ruleTraces.length > 0) {
      expect(output.ruleTraces[0]?.traceId).toMatch(/^trc_/);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Verdict merge
// ---------------------------------------------------------------------------

describe("mergeVerdicts", () => {
  it("empty contributions → allow", () => {
    expect(mergeVerdicts([]).type).toBe("allow");
  });

  it("block wins over flag and allow", () => {
    const result = mergeVerdicts([
      allowContribution(),
      flagContribution("risk"),
      blockContribution("fraud"),
      noOpinion(),
    ]);
    expect(result.type).toBe("block");
  });

  it("flag wins over allow and no_opinion", () => {
    const result = mergeVerdicts([
      allowContribution(),
      flagContribution("suspicious"),
      noOpinion(),
    ]);
    expect(result.type).toBe("flag");
  });

  it("allow wins over no_opinion", () => {
    const result = mergeVerdicts([noOpinion(), allowContribution()]);
    expect(result.type).toBe("allow");
  });

  it("single contribution is returned as-is", () => {
    const contrib = blockContribution("test block");
    const result = mergeVerdicts([contrib]);
    expect(result.type).toBe("block");
    if (result.type === "block") expect(result.reason).toBe("test block");
  });
});

// ---------------------------------------------------------------------------
// 6. Rule registry
// ---------------------------------------------------------------------------

describe("Rule registry", () => {
  it("registers and lists builtin rules", () => {
    setupRegistry();
    const ids = listRegisteredRuleIds();
    expect(ids).toHaveLength(2);
  });

  it("getEnabledRules returns rules in registration order", () => {
    setupRegistry();
    const rules = getEnabledRules([...ALL_BUILTIN_RULE_IDS]);
    expect(rules).toHaveLength(2);
    expect(rules[0]?.id).toBe(SMART_NOTIFICATION_RULE_ID);
    expect(rules[1]?.id).toBe(TIMEZONE_RISK_RULE_ID);
  });

  it("getEnabledRules respects the enabled subset", () => {
    setupRegistry();
    const rules = getEnabledRules([TIMEZONE_RISK_RULE_ID]);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe(TIMEZONE_RISK_RULE_ID);
  });

  it("throws on duplicate rule ID registration", () => {
    setupRegistry();
    expectToThrow(
      () => registerRule(smartNotificationRule),
      "Duplicate rule ID"
    );
  });

  it("throws when registering after freeze", () => {
    setupRegistry();
    freezeRegistry();
    expectToThrow(
      () =>
        registerRule({
          id: "LATE_RULE",
          name: "Late",
          version: "1.0.0",
          description: "Should not register",
          applies: () => false,
          evaluate: () => {
            throw new Error("should not run");
          },
        }),
      "frozen"
    );
    // cleanup — unfreeze for subsequent tests
    _resetRegistryForTesting();
    _resetBuiltinRegistrationFlag();
  });

  it("isRegistryFrozen returns correct state", () => {
    setupRegistry();
    expect(isRegistryFrozen()).toBe(false);
    freezeRegistry();
    expect(isRegistryFrozen()).toBe(true);
    _resetRegistryForTesting();
    _resetBuiltinRegistrationFlag();
    expect(isRegistryFrozen()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. ID generator
// ---------------------------------------------------------------------------

describe("ID generator", () => {
  it("generateTraceId has trc_ prefix", () => {
    _resetCounterForTesting();
    const id = generateTraceId("RULE_1", "evt_1");
    expect(id).toMatch(/^trc_/);
  });

  it("generateDecisionId has dec_ prefix", () => {
    const id = generateDecisionId("evt_abc");
    expect(id).toMatch(/^dec_/);
  });

  it("two calls produce different IDs", () => {
    const id1 = generateTraceId("RULE_1", "evt_1");
    const id2 = generateTraceId("RULE_1", "evt_1");
    expect(id1).not.toBe(id2);
  });

  it("different ruleIds produce different IDs", () => {
    const id1 = generateTraceId("RULE_A", "evt_1");
    const id2 = generateTraceId("RULE_B", "evt_1");
    // Prefix hash segments differ
    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// 8. Error isolation — throwing rule
// ---------------------------------------------------------------------------

describe("Error isolation — throwing rule", () => {
  it("a throwing rule produces an error trace but does not crash the engine", () => {
    setupRegistry();

    // Register a rule that always throws
    registerRule({
      id: "ALWAYS_THROWS",
      name: "Always Throws",
      version: "0.0.1",
      description: "Test rule that always throws",
      applies: () => true,
      evaluate: () => {
        throw new Error("intentional test error");
      },
    });

    const cfg = buildEngineConfig({
      engineId: "test",
      engineVersion: "1.0.0",
      enabledRuleIds: [SMART_NOTIFICATION_RULE_ID, "ALWAYS_THROWS"],
      security: {
        trustedSourceIds: null,
        allowedChannels: null,
        sanitizePayloads: true,
        capturePayloadSnapshot: false,
        maxTraceRecords: 100,
      },
    });

    const event = makeMessageSentEvent();
    const state = makeBaseState(true);
    const output = evaluateEvent(event, state, cfg);

    // Should not crash — returns a result
    expect(typeof output.decision.decisionId).toBe("string");

    // Error rule should produce an error trace
    const errorTrace = output.ruleTraces.find((t) => t.ruleId === "ALWAYS_THROWS");
    expect(errorTrace).not.toBeUndefined();
    expect(errorTrace?.outcome).toBe("error");

    // Smart notification still ran and emitted revenue
    expect(output.revenueEvents).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 9. Validation rejection
// ---------------------------------------------------------------------------

describe("Validation rejection", () => {
  it("null input → error verdict, no rules fire", () => {
    setupRegistry();
    const cfg = makeConfig();
    const state = makeBaseState();
    const output = evaluateEvent(null, state, cfg);
    expect(output.decision.verdict).toBe("error");
    expect(output.revenueEvents).toHaveLength(0);
    expect(output.riskEvents).toHaveLength(0);
  });

  it("string input → error verdict", () => {
    setupRegistry();
    const cfg = makeConfig();
    const state = makeBaseState();
    const output = evaluateEvent("not an event", state, cfg);
    expect(output.decision.verdict).toBe("error");
  });

  it("partial event (missing payload) → error verdict", () => {
    setupRegistry();
    const cfg = makeConfig();
    const state = makeBaseState();
    const partial = {
      id: "evt_x",
      type: MESSAGE_SENT,
      timestamp: new Date().toISOString(),
      // payload missing
      source: TEST_SOURCE,
      metadata: { createdAt: new Date().toISOString() },
      severity: "info",
      priority: "normal",
    };
    const output = evaluateEvent(partial, state, cfg);
    expect(output.decision.verdict).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// 10. Limit enforcement
// ---------------------------------------------------------------------------

describe("Limit enforcement", () => {
  it("oversized payload returns block verdict, no rules fire", () => {
    setupRegistry();
    const cfg = makeConfig();
    const event = makeMessageSentEvent({
      payload: { recipientId: "u1", data: "x".repeat(40_000) },
    });
    const state = makeBaseState();
    const output = evaluateEvent(event, state, cfg);
    expect(output.decision.verdict).toBe("block");
    expect(output.ruleTraces).toHaveLength(0);
  });

  it("rule count limit produces error verdict", () => {
    setupRegistry();
    // Lower the limit below number of registered rules (2)
    const cfg = buildEngineConfig({
      engineId: "test",
      engineVersion: "1.0.0",
      enabledRuleIds: [...ALL_BUILTIN_RULE_IDS],
      limits: {
        maxRulesPerEvaluation: 1, // only 1 allowed, 2 registered
        maxRuleExecutionMs: 50,
        maxTotalExecutionMs: 200,
        maxPayloadBytes: 32_768,
      },
      security: {
        trustedSourceIds: null,
        allowedChannels: null,
        sanitizePayloads: true,
        capturePayloadSnapshot: false,
        maxTraceRecords: 100,
      },
    });
    const event = makeMessageSentEvent();
    const state = makeBaseState();
    const output = evaluateEvent(event, state, cfg);
    expect(output.decision.verdict).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Minimal context builder (used by unit rule tests)
// ---------------------------------------------------------------------------

import type { EvaluationContext } from "./src/core/evaluation-context.js";

function makeMinimalContext(
  event: DomainEvent,
  state: SimulationState,
  config: EngineConfig,
  revenueCapture: unknown[] = [],
  riskCapture: unknown[] = []
): EvaluationContext {
  return {
    event,
    state,
    config,
    evaluationSequence: 1,
    batchTimestamp: new Date().toISOString(),
    emitRevenue: (partial) => revenueCapture.push(partial),
    emitRisk: (partial) => riskCapture.push(partial),
  };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

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
