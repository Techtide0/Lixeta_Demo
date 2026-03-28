/**
 * @file timezone-risk.rule.ts
 * @description Timezone Risk Rule
 *
 * Business Logic
 * ──────────────
 * Detects when a payment is initiated at an unusual local hour for the
 * recipient's timezone. Transactions between 00:00–06:00 local time are
 * flagged as potential fraud indicators, particularly for retail payments
 * where the customer is unlikely to be awake.
 *
 * Risk impact:   High-severity risk signal emitted for out-of-window payments.
 * Revenue impact: None directly.
 * Verdict:        "flag" if out-of-window; "allow" otherwise.
 *
 * Rule ID:  TIMEZONE_RISK_V1
 * Version:  1.0.0
 */

import type { RuleTrace, ConditionTrace, ActionTrace } from "@lixeta/models";
import { PAYMENT_INITIATED, USER_LOGIN, USER_AUTHENTICATED } from "@lixeta/models";
import type { Rule, RuleEvaluationResult } from "../core/rule.js";
import { allowContribution, flagContribution } from "../core/rule.js";
import type { EvaluationContext } from "../core/evaluation-context.js";
import { generateTraceId } from "../utils/id-generator.js";

export const TIMEZONE_RISK_RULE_ID = "TIMEZONE_RISK_V1" as const;

/** Local hours considered abnormal for payments (midnight to 5:59am local) */
const ABNORMAL_HOUR_START = 0;
const ABNORMAL_HOUR_END   = 5;

// ---------------------------------------------------------------------------
// Local hour resolution
// ---------------------------------------------------------------------------

function getLocalHour(timezone: string, isoTimestamp: string): number | null {
  try {
    const date = new Date(isoTimestamp);
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    });
    const parts = formatter.formatToParts(date);
    const hourPart = parts.find((p) => p.type === "hour");
    if (hourPart === undefined) return null;
    const hour = parseInt(hourPart.value, 10);
    return isNaN(hour) ? null : hour;
  } catch {
    return null;
  }
}

/** Extract hour from payload (simulation override) or event timestamp */
function resolveHour(ctx: EvaluationContext, timezone: string): number | null {
  const payload = ctx.event.payload as Record<string, unknown>;
  if (typeof payload["hour"] === "number") {
    const h = payload["hour"];
    if (h >= 0 && h <= 23) return h;
  }
  return getLocalHour(timezone, ctx.event.timestamp);
}

// ---------------------------------------------------------------------------
// Rule implementation
// ---------------------------------------------------------------------------

export const timezoneRiskRule: Rule = {
  id: TIMEZONE_RISK_RULE_ID,
  name: "Timezone Risk",
  version: "1.1.0",
  description:
    "Flags events that occur during abnormal local hours — payments between " +
    "midnight and 06:00, or user logins where device timezone differs significantly " +
    "from the account's registered timezone.",

  applies(ctx: EvaluationContext): boolean {
    // Payment path — abnormal-hour check on recipient timezone
    if (ctx.event.type === PAYMENT_INITIATED) return true;
    // User event path — timezone mismatch between device and account
    if (ctx.event.type === USER_LOGIN || ctx.event.type === USER_AUTHENTICATED) {
      const p = ctx.event.payload as Record<string, unknown>;
      return typeof p["deviceTimezone"] === "string" || typeof p["accountTimezone"] === "string";
    }
    return false;
  },

  evaluate(ctx: EvaluationContext): RuleEvaluationResult {
    const { event } = ctx;
    const traceId = generateTraceId(TIMEZONE_RISK_RULE_ID, event.id);
    const payload = event.payload as Record<string, unknown>;

    // ── USER LOGIN TIMEZONE MISMATCH PATH ──────────────────────────────────
    const isUserEvent = event.type === USER_LOGIN || event.type === USER_AUTHENTICATED;
    if (isUserEvent) {
      const deviceTimezone  = typeof payload["deviceTimezone"]  === "string" ? payload["deviceTimezone"]  : null;
      const accountTimezone = typeof payload["accountTimezone"] === "string" ? payload["accountTimezone"] : null;

      // Compute local hour in both timezones and check offset difference
      const deviceHour  = deviceTimezone  ? resolveHour(ctx, deviceTimezone)  : null;
      const accountHour = accountTimezone ? resolveHour(ctx, accountTimezone) : null;
      // Use circular distance (mod 24) so that e.g. hour 23 vs hour 1
      // gives a delta of 2, not 22.
      const rawDelta = (deviceHour !== null && accountHour !== null)
        ? Math.abs(deviceHour - accountHour)
        : null;
      const hourDelta = rawDelta !== null ? Math.min(rawDelta, 24 - rawDelta) : null;

      // Suspicious if timezone difference >= 4 hours
      const SUSPICIOUS_DELTA = 4;
      const isSuspicious = hourDelta !== null && hourDelta >= SUSPICIOUS_DELTA;

      const conditions: ConditionTrace[] = [
        {
          description: `event.type is a user event`,
          actualValue: event.type,
          expectedValue: `${USER_LOGIN} | ${USER_AUTHENTICATED}`,
          passed: true,
        },
        {
          description: `Device timezone hour vs account timezone hour delta >= ${SUSPICIOUS_DELTA}h`,
          actualValue: hourDelta !== null ? `${hourDelta}h delta` : "cannot determine",
          expectedValue: `>= ${SUSPICIOUS_DELTA}h`,
          passed: isSuspicious,
        },
      ];

      const actions: ActionTrace[] = [];

      if (isSuspicious) {
        ctx.emitRisk({
          triggeringEventId: event.id,
          triggeringEventType: event.type,
          triggeringRuleId: TIMEZONE_RISK_RULE_ID,
          triggeringRuleName: "Timezone Risk",
          category: "timezone_mismatch",
          severity: "medium",
          score: 0.65,
          description: `Login timezone mismatch: device in ${deviceTimezone} (hour ${deviceHour}), account in ${accountTimezone} (hour ${accountHour}) — ${hourDelta}h difference`,
          evidence: {
            type: "timezone",
            recipientTimezone: accountTimezone ?? "unknown",
            transactionLocalHour: deviceHour ?? 0,
            normalWindowStart: 0,
            normalWindowEnd: SUSPICIOUS_DELTA - 1,
          },
        });

        actions.push({
          actionType: "emit_timezone_mismatch",
          description: `Timezone mismatch flagged — ${hourDelta}h delta between device and account`,
          executed: true,
          result: { deviceTimezone, accountTimezone, deviceHour, accountHour, hourDelta, riskScore: 0.65 },
        });

        const trace = buildTrace(
          traceId, ctx, "fired",
          `FLAGGED: Login timezone mismatch — ${hourDelta}h delta (device: ${deviceTimezone}, account: ${accountTimezone}).`,
          conditions, actions
        );

        return {
          trace,
          verdictContribution: flagContribution(
            `Timezone mismatch: ${hourDelta}h delta between device (${deviceTimezone}) and account (${accountTimezone})`
          ),
        };
      }

      actions.push({
        actionType: "no_action",
        description: `Timezone delta acceptable (${hourDelta ?? "unknown"}h). No risk signal.`,
        executed: true,
        result: { deviceTimezone, accountTimezone, deviceHour, accountHour, hourDelta },
      });

      const trace = buildTrace(
        traceId, ctx, "no_match",
        `Timezone delta ${hourDelta ?? "unknown"}h — within acceptable range. No risk.`,
        conditions, actions
      );

      return { trace, verdictContribution: allowContribution() };
    }

    // ── PAYMENT ABNORMAL-HOUR PATH ─────────────────────────────────────────
    const timezone  = typeof payload["recipientTimezone"] === "string"
      ? payload["recipientTimezone"] : "UTC";
    const localHour = resolveHour(ctx, timezone);

    const isAbnormal =
      localHour !== null &&
      localHour >= ABNORMAL_HOUR_START &&
      localHour <= ABNORMAL_HOUR_END;

    const conditions: ConditionTrace[] = [
      {
        description: "event.type === PAYMENT_INITIATED",
        actualValue: event.type,
        expectedValue: PAYMENT_INITIATED,
        passed: true,
      },
      {
        description: `localHour is between ${ABNORMAL_HOUR_START}:00 and ${ABNORMAL_HOUR_END}:59`,
        actualValue: localHour,
        expectedValue: `<= ${ABNORMAL_HOUR_END}`,
        passed: localHour !== null && localHour >= ABNORMAL_HOUR_START && localHour <= ABNORMAL_HOUR_END,
      },
    ];

    const actions: ActionTrace[] = [];

    if (isAbnormal) {
      ctx.emitRisk({
        triggeringEventId: event.id,
        triggeringEventType: event.type,
        triggeringRuleId: TIMEZONE_RISK_RULE_ID,
        triggeringRuleName: "Timezone Risk",
        category: "timezone_mismatch",
        severity: "high",
        score: 0.75,
        description: `Payment at ${localHour}:xx local time (${timezone}) — outside normal window 06:00–23:59`,
        evidence: {
          type: "timezone",
          recipientTimezone: timezone,
          transactionLocalHour: localHour,
          normalWindowStart: 6,
          normalWindowEnd: 23,
        },
      });

      actions.push({
        actionType: "emit_risk_signal",
        description: "Risk signal emitted for abnormal-hours payment",
        executed: true,
        result: { localHour, timezone, riskScore: 0.75 },
      });

      const trace = buildTrace(
        traceId, ctx, "fired",
        `Payment at local hour ${localHour} (${timezone}) is outside normal window. Risk flagged.`,
        conditions, actions
      );

      return {
        trace,
        verdictContribution: flagContribution(
          `Payment at unusual local hour ${localHour} in timezone ${timezone}`
        ),
      };
    }

    actions.push({
      actionType: "no_action",
      description: "Payment within normal hours — no risk signal",
      executed: true,
      result: { localHour, timezone },
    });

    const trace = buildTrace(
      traceId, ctx, "no_match",
      `Payment at local hour ${localHour ?? "unknown"} (${timezone}) — within normal window.`,
      conditions, actions
    );

    return { trace, verdictContribution: allowContribution() };
  },
};

function buildTrace(
  traceId: string, ctx: EvaluationContext,
  outcome: "fired" | "no_match", explanation: string,
  conditions: ReadonlyArray<ConditionTrace>, actions: ReadonlyArray<ActionTrace>
): RuleTrace {
  return {
    traceId,
    ruleId: TIMEZONE_RISK_RULE_ID,
    ruleName: "Timezone Risk",
    ruleVersion: "1.1.0",
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
    },
  };
}


