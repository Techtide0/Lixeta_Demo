/**
 * @file sla-killswitch.rule.ts
 * @description SLA Kill Switch Rule — Stateful Time Tracking
 *
 * Business Logic
 * ──────────────
 * When a message.sent event arrives, the engine checks whether any previous
 * decision in this session was a "defer" verdict that has now exceeded the
 * SLA threshold (30 seconds). If the SLA is breached, the system escalates:
 * it emits an SLA breach risk signal, records a penalty revenue loss, and
 * flags the current decision for immediate review.
 *
 * This prevents deferred messages from silently expiring without consequence —
 * a real system must know when its own deferrals have gone stale.
 *
 * Revenue impact:  Loss — penalty cost emitted per SLA breach detected.
 * Risk impact:     High-severity "sla_breach" signal per breached deferral.
 * Verdict:         "flag" if any SLA breach detected; "allow" otherwise.
 *
 * Rule ID:  SLA_KILLSWITCH_V1
 * Version:  1.0.0
 */

import type { RuleTrace, ConditionTrace, ActionTrace } from "@lixeta/models";
import { MESSAGE_SENT, PAYMENT_FAILED } from "@lixeta/models";
import type { Rule, RuleEvaluationResult } from "../core/rule.js";
import { allowContribution, flagContribution } from "../core/rule.js";
import type { EvaluationContext } from "../core/evaluation-context.js";
import { generateTraceId } from "../utils/id-generator.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SLA_KILLSWITCH_RULE_ID = "SLA_KILLSWITCH_V1" as const;

/** SLA threshold: deferred decisions older than this are breached (ms) */
const SLA_THRESHOLD_MS = 30_000; // 30 seconds

/** Penalty per SLA breach in kobo (₦5 penalty per breach) */
const SLA_PENALTY_KOBO = 500;

// ---------------------------------------------------------------------------
// Rule implementation
// ---------------------------------------------------------------------------

export const slaKillswitchRule: Rule = {
  id: SLA_KILLSWITCH_RULE_ID,
  name: "SLA Kill Switch",
  version: "1.0.0",
  description:
    "Detects when previously deferred decisions have exceeded the SLA window " +
    "(30 s). Emits a breach risk signal and penalty cost, then flags the event " +
    "for immediate review to prevent silent SLA violations.",

  applies(ctx: EvaluationContext): boolean {
    // Path A — state-based: message.sent when prior decisions exist
    if (ctx.event.type === MESSAGE_SENT && Object.keys(ctx.state.decisions).length > 0) {
      return true;
    }
    // Path B — explicit signal: payment.failed with slaExceeded flag in payload
    if (ctx.event.type === PAYMENT_FAILED) {
      const payload = ctx.event.payload as Record<string, unknown>;
      if (payload["slaExceeded"] === true) return true;
    }
    return false;
  },

  evaluate(ctx: EvaluationContext): RuleEvaluationResult {
    const { event, state, config } = ctx;
    const traceId = generateTraceId(SLA_KILLSWITCH_RULE_ID, event.id);
    const now = Date.now();

    // Determine trigger path
    const isExplicitSignal =
      event.type === PAYMENT_FAILED &&
      (event.payload as Record<string, unknown>)["slaExceeded"] === true;

    // Build set of decision IDs that already had a breach penalty recorded.
    // This prevents the same deferred decision from being penalised on every
    // subsequent event — each breach is only charged once.
    const alreadyPenalized = new Set<string>(
      state.riskEvents
        .filter(r => r.category === "sla_breach")
        .flatMap(r => {
          const ev = r.evidence as { type: string; facts?: Record<string, unknown> };
          const id = ev.facts?.["breachedDecisionId"];
          return typeof id === "string" ? [id] : [];
        })
    );

    // Scan all past decisions for "defer" verdicts that have breached SLA
    // and have NOT already been penalised.
    const allDecisions = Object.values(state.decisions);
    const deferredDecisions = allDecisions.filter(d => d.verdict === "defer");
    const breachedDecisions = deferredDecisions.filter(d => {
      const age = now - new Date(d.decidedAt).getTime();
      return age >= SLA_THRESHOLD_MS && !alreadyPenalized.has(d.decisionId);
    });

    // Explicit signal always counts as a breach even if no prior deferred decisions
    const hasBreach = isExplicitSignal || breachedDecisions.length > 0;

    const conditions: ConditionTrace[] = [
      {
        description: "event is SLA-relevant (message.sent with prior decisions OR payment.failed with slaExceeded: true)",
        actualValue: event.type,
        expectedValue: `${MESSAGE_SENT} (with decisions) | ${PAYMENT_FAILED} + slaExceeded`,
        passed: true,
      },
      {
        description: isExplicitSignal
          ? "Explicit slaExceeded signal detected in payload"
          : `Deferred decisions older than SLA threshold (${SLA_THRESHOLD_MS / 1000}s)`,
        actualValue: isExplicitSignal ? "slaExceeded: true" : breachedDecisions.length,
        expectedValue: isExplicitSignal ? "true" : "> 0",
        passed: hasBreach,
      },
    ];

    const actions: ActionTrace[] = [];

    if (hasBreach) {
      const breachCount = isExplicitSignal
        ? Math.max(1, breachedDecisions.length)
        : breachedDecisions.length;

      // Emit one risk signal per breached decision (or one for explicit signal)
      if (isExplicitSignal && breachedDecisions.length === 0) {
        // Explicit payment.failed + slaExceeded signal with no prior deferred decisions
        ctx.emitRisk({
          triggeringEventId: event.id,
          triggeringEventType: event.type,
          triggeringRuleId: SLA_KILLSWITCH_RULE_ID,
          triggeringRuleName: "SLA Kill Switch",
          category: "sla_breach",
          severity: "high",
          score: 0.85,
          description: `Explicit SLA breach signal on payment.failed — slaExceeded flag raised by upstream system`,
          evidence: {
            type: "generic",
            facts: {
              triggerSource: "explicit_signal",
              eventType: event.type,
              slaExceeded: true,
              slaThresholdMs: SLA_THRESHOLD_MS,
            },
          },
        });
      } else {
        for (const breached of breachedDecisions) {
          const ageMs = now - new Date(breached.decidedAt).getTime();
          ctx.emitRisk({
            triggeringEventId: event.id,
            triggeringEventType: event.type,
            triggeringRuleId: SLA_KILLSWITCH_RULE_ID,
            triggeringRuleName: "SLA Kill Switch",
            category: "sla_breach",
            severity: "high",
            score: 0.85,
            description: `Deferred decision ${breached.decisionId} breached SLA: ${Math.round(ageMs / 1000)}s elapsed (threshold: ${SLA_THRESHOLD_MS / 1000}s)`,
            evidence: {
              type: "generic",
              facts: {
                breachedDecisionId: breached.decisionId,
                originalVerdict: breached.verdict,
                decidedAt: breached.decidedAt,
                ageMs,
                slaThresholdMs: SLA_THRESHOLD_MS,
              },
            },
          });
        }
      }

      // Emit a penalty revenue loss for the aggregate breach
      ctx.emitRevenue({
        triggeringEventId: event.id,
        triggeringEventType: event.type,
        triggeringRuleId: SLA_KILLSWITCH_RULE_ID,
        triggeringRuleName: "SLA Kill Switch",
        category: "penalty",
        direction: "loss",
        amount: {
          amountMinorUnits: SLA_PENALTY_KOBO * breachCount,
          currency: config.revenue.currency,
        },
        description: isExplicitSignal
          ? `SLA breach penalty: explicit slaExceeded signal on ${event.type}`
          : `SLA breach penalty: ${breachedDecisions.length} deferred decision(s) exceeded ${SLA_THRESHOLD_MS / 1000}s threshold`,
        metadata: {
          breachCount,
          penaltyPerBreachKobo: SLA_PENALTY_KOBO,
          triggerSource: isExplicitSignal ? "explicit_signal" : "state_scan",
          ruleVersion: "1.0.0",
        },
      });

      actions.push({
        actionType: "emit_sla_breach",
        description: isExplicitSignal
          ? `SLA breach via explicit signal (payment.failed + slaExceeded: true)`
          : `${breachedDecisions.length} SLA breach(es) detected via state scan`,
        executed: true,
        result: {
          breachCount,
          totalPenaltyKobo: SLA_PENALTY_KOBO * breachCount,
          currency: config.revenue.currency,
          triggerSource: isExplicitSignal ? "explicit_signal" : "state_scan",
        },
      });

      const breachDesc = isExplicitSignal
        ? `Explicit SLA breach signal (payment.failed + slaExceeded). Penalty emitted. Event flagged.`
        : `${breachedDecisions.length} deferred decision(s) exceeded SLA (${SLA_THRESHOLD_MS / 1000}s). Breach signals emitted. Event flagged.`;

      const trace = buildTrace(traceId, ctx, "fired", breachDesc, conditions, actions);

      return {
        trace,
        verdictContribution: flagContribution(
          isExplicitSignal
            ? `SLA breach: explicit slaExceeded signal on ${event.type}`
            : `SLA breach: ${breachedDecisions.length} deferred decision(s) exceeded ${SLA_THRESHOLD_MS / 1000}s window`
        ),
      };
    }

    // No SLA breach
    actions.push({
      actionType: "no_action",
      description: `No SLA breaches detected. ${deferredDecisions.length} deferred decision(s) all within threshold.`,
      executed: true,
      result: {
        deferredCount: deferredDecisions.length,
        breachedCount: 0,
        slaThresholdMs: SLA_THRESHOLD_MS,
      },
    });

    const trace = buildTrace(
      traceId, ctx, "no_match",
      `No SLA breaches. ${deferredDecisions.length} deferred decision(s) within the ${SLA_THRESHOLD_MS / 1000}s window.`,
      conditions, actions
    );

    return { trace, verdictContribution: allowContribution() };
  },
};

// ---------------------------------------------------------------------------
// Trace builder
// ---------------------------------------------------------------------------

function buildTrace(
  traceId: string,
  ctx: EvaluationContext,
  outcome: "fired" | "no_match",
  explanation: string,
  conditions: ReadonlyArray<ConditionTrace>,
  actions: ReadonlyArray<ActionTrace>
): RuleTrace {
  return {
    traceId,
    ruleId: SLA_KILLSWITCH_RULE_ID,
    ruleName: "SLA Kill Switch",
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
      totalDecisions: Object.keys(ctx.state.decisions).length,
    },
  };
}
