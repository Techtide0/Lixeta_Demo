/**
 * @file diaspora-risk.rule.ts
 * @description Diaspora Risk Rule — Payment Velocity & Fraud Intelligence
 *
 * Business Logic
 * ──────────────
 * Payment events in the diaspora corridor (cross-border remittances, foreign
 * card usage, and high-frequency small payments) follow distinct velocity
 * patterns that differ from local retail activity. This rule detects two
 * risk scenarios:
 *
 * 1. VELOCITY BREACH — If 3 or more payment events (initiated/succeeded/reversed)
 *    have been processed in the current session, a velocity anomaly is raised.
 *    Rapid payment activity in a short window is a leading fraud indicator.
 *
 * 2. REVERSAL ESCALATION — If a payment.reversed event arrives and there are
 *    already 2+ reversals in the session, the pattern is escalated to "block"
 *    as repeated reversals indicate dispute abuse or chargeback fraud.
 *
 * Revenue impact:  Indirect gain — blocking fraud prevents revenue loss.
 * Risk impact:     High-severity velocity_breach or pattern_deviation signal.
 * Verdict:         "flag" on velocity breach; "block" on reversal escalation.
 *
 * Rule ID:  DIASPORA_RISK_V1
 * Version:  1.0.0
 */
import { PAYMENT_INITIATED, PAYMENT_SUCCEEDED, PAYMENT_REVERSED, USER_LOGIN, USER_AUTHENTICATED, } from "@lixeta/models";
import { allowContribution, flagContribution, blockContribution } from "../core/rule.js";
import { generateTraceId } from "../utils/id-generator.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const DIASPORA_RISK_RULE_ID = "DIASPORA_RISK_V1";
/** Number of reversals in one session before escalation to block */
const REVERSAL_BLOCK_THRESHOLD = 2;
/**
 * Resolve velocity threshold based on aggressionLevel.
 * Level 0  → 5 payments required (conservative)
 * Level 50 → 3 payments (default)
 * Level 100 → 2 payments (aggressive)
 */
function resolveVelocityThreshold(aggressionLevel) {
    const t = aggressionLevel / 100;
    // At 0%: 5. At 50%: 3. At 100%: 2.
    return Math.max(2, Math.round(5 - t * 3));
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getEventCount(ctx, eventType) {
    const counters = ctx.state.counters.eventCountByType;
    return counters[eventType] ?? 0;
}
// ---------------------------------------------------------------------------
// Rule implementation
// ---------------------------------------------------------------------------
export const diasporaRiskRule = {
    id: DIASPORA_RISK_RULE_ID,
    name: "Diaspora Risk",
    version: "1.0.0",
    description: "Detects high-velocity payment activity and repeated reversals within a " +
        "session — common fraud patterns in diaspora and cross-border payment flows.",
    applies(ctx) {
        // Payment velocity path
        if (ctx.event.type === PAYMENT_INITIATED ||
            ctx.event.type === PAYMENT_SUCCEEDED ||
            ctx.event.type === PAYMENT_REVERSED)
            return true;
        // Geo-anomaly path — user events with country fields present
        if (ctx.event.type === USER_LOGIN || ctx.event.type === USER_AUTHENTICATED) {
            const p = ctx.event.payload;
            return typeof p["deviceCountry"] === "string" || typeof p["accountCountry"] === "string";
        }
        return false;
    },
    evaluate(ctx) {
        const { event, config } = ctx;
        const traceId = generateTraceId(DIASPORA_RISK_RULE_ID, event.id);
        // ── GEO ANOMALY PATH (user.login / user.authenticated) ──────────────────
        const isUserEvent = event.type === USER_LOGIN || event.type === USER_AUTHENTICATED;
        if (isUserEvent) {
            const payload = event.payload;
            const deviceCountry = typeof payload["deviceCountry"] === "string" ? payload["deviceCountry"] : null;
            const accountCountry = typeof payload["accountCountry"] === "string" ? payload["accountCountry"] : null;
            const countryMismatch = deviceCountry !== null && accountCountry !== null && deviceCountry !== accountCountry;
            const conditions = [
                {
                    description: "event.type is a user event",
                    actualValue: event.type,
                    expectedValue: `${USER_LOGIN} | ${USER_AUTHENTICATED}`,
                    passed: true,
                },
                {
                    description: "deviceCountry !== accountCountry (geo anomaly)",
                    actualValue: `${deviceCountry ?? "??"} vs ${accountCountry ?? "??"}`,
                    expectedValue: "match",
                    passed: countryMismatch,
                },
            ];
            const actions = [];
            if (countryMismatch) {
                ctx.emitRisk({
                    triggeringEventId: event.id,
                    triggeringEventType: event.type,
                    triggeringRuleId: DIASPORA_RISK_RULE_ID,
                    triggeringRuleName: "Diaspora Risk",
                    category: "geo_anomaly",
                    severity: "high",
                    score: 0.78,
                    description: `Country mismatch detected: login from ${deviceCountry} but account registered in ${accountCountry}`,
                    evidence: {
                        type: "geo",
                        expectedCountry: accountCountry,
                        observedCountry: deviceCountry,
                    },
                });
                actions.push({
                    actionType: "flag_geo_anomaly",
                    description: `Login flagged — device country (${deviceCountry}) differs from account country (${accountCountry})`,
                    executed: true,
                    result: { deviceCountry, accountCountry, riskScore: 0.78 },
                });
                const trace = buildTrace(traceId, ctx, "fired", `FLAGGED: Geo anomaly on ${event.type} — device in ${deviceCountry}, account in ${accountCountry}.`, conditions, actions);
                return {
                    trace,
                    verdictContribution: flagContribution(`Geo anomaly: login from ${deviceCountry} but account registered in ${accountCountry}`),
                };
            }
            // Countries match — no action
            actions.push({
                actionType: "no_action",
                description: `No geo anomaly — device and account country match (${deviceCountry ?? "unknown"}).`,
                executed: true,
                result: { deviceCountry, accountCountry },
            });
            const trace = buildTrace(traceId, ctx, "no_match", `User event with matching countries (${deviceCountry ?? "unknown"}). No geo risk.`, conditions, actions);
            return { trace, verdictContribution: allowContribution() };
        }
        // ── PAYMENT VELOCITY PATH ─────────────────────────────────────────────
        // Count prior payment events in this session (state counts events BEFORE this one)
        const priorInitiated = getEventCount(ctx, PAYMENT_INITIATED);
        const priorSucceeded = getEventCount(ctx, PAYMENT_SUCCEEDED);
        const priorReversed = getEventCount(ctx, PAYMENT_REVERSED);
        // Include the current event in the total
        const currentIsInitiated = event.type === PAYMENT_INITIATED ? 1 : 0;
        const currentIsSucceeded = event.type === PAYMENT_SUCCEEDED ? 1 : 0;
        const currentIsReversed = event.type === PAYMENT_REVERSED ? 1 : 0;
        const totalPaymentEvents = priorInitiated + priorSucceeded + priorReversed +
            currentIsInitiated + currentIsSucceeded + currentIsReversed;
        const totalReversals = priorReversed + currentIsReversed;
        const velocityThreshold = resolveVelocityThreshold(ctx.config.aggressionLevel ?? 50);
        const isVelocityBreach = totalPaymentEvents >= velocityThreshold;
        const isReversalEscalation = event.type === PAYMENT_REVERSED && totalReversals >= REVERSAL_BLOCK_THRESHOLD;
        const conditions = [
            {
                description: `event.type is a payment event`,
                actualValue: event.type,
                expectedValue: `${PAYMENT_INITIATED} | ${PAYMENT_SUCCEEDED} | ${PAYMENT_REVERSED}`,
                passed: true,
            },
            {
                description: `Total payment events in session >= velocity threshold (${velocityThreshold})`,
                actualValue: totalPaymentEvents,
                expectedValue: `>= ${velocityThreshold}`,
                passed: isVelocityBreach,
            },
            {
                description: `Total reversals in session >= block threshold (${REVERSAL_BLOCK_THRESHOLD}) on reversal event`,
                actualValue: totalReversals,
                expectedValue: `>= ${REVERSAL_BLOCK_THRESHOLD} on payment.reversed`,
                passed: isReversalEscalation,
            },
        ];
        const actions = [];
        // ── Reversal escalation takes highest priority ──
        if (isReversalEscalation) {
            ctx.emitRisk({
                triggeringEventId: event.id,
                triggeringEventType: event.type,
                triggeringRuleId: DIASPORA_RISK_RULE_ID,
                triggeringRuleName: "Diaspora Risk",
                category: "pattern_deviation",
                severity: "critical",
                score: 0.95,
                description: `Repeated reversal pattern: ${totalReversals} reversals detected in session — possible dispute abuse or chargeback fraud`,
                evidence: {
                    type: "velocity",
                    observedCount: totalReversals,
                    threshold: REVERSAL_BLOCK_THRESHOLD,
                    windowMs: 0, // session-scoped (no fixed time window)
                    partyId: event.source.id,
                },
            });
            actions.push({
                actionType: "block_reversal_escalation",
                description: `Payment blocked — ${totalReversals} reversals in session exceeds fraud threshold (${REVERSAL_BLOCK_THRESHOLD})`,
                executed: true,
                result: {
                    totalReversals,
                    reversalBlockThreshold: REVERSAL_BLOCK_THRESHOLD,
                    riskScore: 0.95,
                },
            });
            const trace = buildTrace(traceId, ctx, "fired", `BLOCKED: ${totalReversals} payment reversals in session. Possible chargeback fraud. Critical risk signal emitted.`, conditions, actions);
            return {
                trace,
                verdictContribution: blockContribution(`Repeated reversal pattern: ${totalReversals} reversals detected (threshold: ${REVERSAL_BLOCK_THRESHOLD})`),
            };
        }
        // ── Velocity breach — flag for review ──
        if (isVelocityBreach) {
            ctx.emitRisk({
                triggeringEventId: event.id,
                triggeringEventType: event.type,
                triggeringRuleId: DIASPORA_RISK_RULE_ID,
                triggeringRuleName: "Diaspora Risk",
                category: "velocity_breach",
                severity: "high",
                score: 0.70,
                description: `Payment velocity breach: ${totalPaymentEvents} payment events in session (threshold: ${velocityThreshold})`,
                evidence: {
                    type: "velocity",
                    observedCount: totalPaymentEvents,
                    threshold: velocityThreshold,
                    windowMs: 0, // session-scoped
                    partyId: event.source.id,
                },
            });
            actions.push({
                actionType: "flag_velocity_breach",
                description: `Payment flagged — ${totalPaymentEvents} payment events in session exceeds velocity threshold (${velocityThreshold})`,
                executed: true,
                result: {
                    totalPaymentEvents,
                    breakdown: {
                        initiated: priorInitiated + currentIsInitiated,
                        succeeded: priorSucceeded + currentIsSucceeded,
                        reversed: priorReversed + currentIsReversed,
                    },
                    velocityThreshold: velocityThreshold,
                    riskScore: 0.70,
                },
            });
            const trace = buildTrace(traceId, ctx, "fired", `FLAGGED: ${totalPaymentEvents} payment events in session exceeds velocity threshold (${velocityThreshold}). Risk signal emitted.`, conditions, actions);
            return {
                trace,
                verdictContribution: flagContribution(`Payment velocity breach: ${totalPaymentEvents} events in session (threshold: ${velocityThreshold})`),
            };
        }
        // ── Normal payment activity ──
        actions.push({
            actionType: "no_action",
            description: `Payment activity within normal bounds. ${totalPaymentEvents}/${velocityThreshold} events in session.`,
            executed: true,
            result: {
                totalPaymentEvents,
                velocityThreshold: velocityThreshold,
                totalReversals,
                reversalBlockThreshold: REVERSAL_BLOCK_THRESHOLD,
            },
        });
        const trace = buildTrace(traceId, ctx, "no_match", `Payment within normal bounds — ${totalPaymentEvents} event(s) in session, ${totalReversals} reversal(s). No risk signals.`, conditions, actions);
        return { trace, verdictContribution: allowContribution() };
    },
};
// ---------------------------------------------------------------------------
// Trace builder
// ---------------------------------------------------------------------------
function buildTrace(traceId, ctx, outcome, explanation, conditions, actions) {
    return {
        traceId,
        ruleId: DIASPORA_RISK_RULE_ID,
        ruleName: "Diaspora Risk",
        ruleVersion: "1.0.0",
        triggeringEventId: ctx.event.id,
        triggeringEventType: ctx.event.type,
        evaluatedAt: ctx.batchTimestamp,
        executionTimeMs: 0,
        outcome,
        explanation,
        conditions,
        actions,
        contextSnapshot: {
            eventId: ctx.event.id,
            eventType: ctx.event.type,
            sequence: ctx.evaluationSequence,
            totalEventsProcessed: ctx.state.counters.totalEventsProcessed,
        },
    };
}
