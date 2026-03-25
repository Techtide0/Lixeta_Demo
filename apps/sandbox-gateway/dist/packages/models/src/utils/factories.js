/**
 * @file factories.ts
 * @description Pure factory functions for constructing model instances.
 *
 * These functions:
 *   - Accept partial/raw input and return fully-typed, validated objects
 *   - Guarantee all required fields are present
 *   - Apply sensible defaults so callers don't repeat boilerplate
 *   - Are the ONLY place where model objects should be constructed
 *
 * They do NOT persist, mutate global state, or have side effects.
 */
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function nowISO() {
    return new Date().toISOString();
}
// ---------------------------------------------------------------------------
// EventSource factory
// ---------------------------------------------------------------------------
export function createEventSource(overrides) {
    return {
        version: "1.0.0",
        channel: "internal",
        ...overrides,
    };
}
// ---------------------------------------------------------------------------
// EventMetadata factory
// ---------------------------------------------------------------------------
export function createEventMetadata(overrides) {
    return {
        createdAt: nowISO(),
        ...overrides,
    };
}
export function createDomainEvent(input) {
    return {
        id: input.id,
        type: input.type,
        timestamp: input.timestamp ?? nowISO(),
        payload: input.payload,
        source: input.source,
        severity: input.severity ?? "info",
        priority: input.priority ?? "normal",
        metadata: createEventMetadata(input.metadata),
    };
}
// ---------------------------------------------------------------------------
// SimulationState factory
// ---------------------------------------------------------------------------
export function createInitialSimulationState(id, config) {
    const counters = {
        totalEventsProcessed: 0,
        totalRulesFired: 0,
        totalRulesSkipped: 0,
        totalRuleErrors: 0,
        totalTransactions: 0,
        totalDecisions: 0,
        eventCountByType: {},
    };
    const timing = {
        startedAt: null,
        pausedAt: null,
        completedAt: null,
        totalPausedMs: 0,
        elapsedMs: 0,
    };
    return {
        id,
        config,
        status: "idle",
        timing,
        events: [],
        revenueEvents: [],
        riskEvents: [],
        ruleTraces: [],
        decisions: {},
        counters,
        lastError: null,
    };
}
// ---------------------------------------------------------------------------
// Money factory
// ---------------------------------------------------------------------------
export function createMoney(amountMinorUnits, currency) {
    return { amountMinorUnits, currency: currency.toUpperCase() };
}
export function createRevenueEvent(input) {
    const base = {
        id: input.id,
        recordedAt: nowISO(),
        triggeringEventId: input.triggeringEventId,
        triggeringEventType: input.triggeringEventType,
        triggeringRuleId: input.triggeringRuleId ?? null,
        triggeringRuleName: input.triggeringRuleName ?? null,
        category: input.category,
        direction: input.direction,
        amount: input.amount,
        description: input.description,
        metadata: input.metadata ?? {},
    };
    if (input.externalRef !== undefined) {
        return { ...base, externalRef: input.externalRef };
    }
    return base;
}
export function createRiskEvent(input) {
    return {
        id: input.id,
        detectedAt: nowISO(),
        triggeringEventId: input.triggeringEventId,
        triggeringEventType: input.triggeringEventType,
        triggeringRuleId: input.triggeringRuleId ?? null,
        triggeringRuleName: input.triggeringRuleName ?? null,
        category: input.category,
        severity: input.severity,
        status: "open",
        score: input.score,
        description: input.description,
        evidence: input.evidence,
    };
}
export function createRuleTrace(input) {
    return {
        traceId: input.traceId,
        ruleId: input.ruleId,
        ruleName: input.ruleName,
        ruleVersion: input.ruleVersion,
        triggeringEventId: input.triggeringEventId,
        triggeringEventType: input.triggeringEventType,
        evaluatedAt: nowISO(),
        executionTimeMs: input.executionTimeMs,
        outcome: input.outcome,
        explanation: input.explanation,
        conditions: input.conditions,
        actions: input.actions,
        contextSnapshot: input.contextSnapshot ?? {},
    };
}
export function createDecisionResult(input) {
    const base = {
        decisionId: input.decisionId,
        sourceEventId: input.sourceEventId,
        sourceEventType: input.sourceEventType,
        decidedAt: nowISO(),
        totalExecutionTimeMs: input.totalExecutionTimeMs,
        verdict: input.verdict,
        reason: input.reason,
        confidence: input.confidence,
        appliedRuleTraces: input.appliedRuleTraces ?? [],
        appliedActions: input.appliedActions ?? [],
    };
    const mutable = base;
    if (input.transformedPayload !== undefined) {
        mutable["transformedPayload"] = input.transformedPayload;
    }
    if (input.deferUntil !== undefined) {
        mutable["deferUntil"] = input.deferUntil;
    }
    if (input.engineError !== undefined) {
        mutable["engineError"] = input.engineError;
    }
    return base;
}
