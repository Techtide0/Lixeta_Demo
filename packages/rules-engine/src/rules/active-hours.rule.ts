/**
 * @file active-hours.rule.ts
 * @description Active Hours Rule — Time Intelligence
 *
 * Business Logic
 * ──────────────
 * Messages sent outside the active engagement window (08:00–20:59 WAT,
 * West Africa Time / Africa/Lagos, UTC+1) are deferred until the next
 * 08:00 window. Sending notifications when users are asleep or inactive
 * wastes budget and hurts engagement metrics.
 *
 * Revenue impact:  Indirect gain — deferred messages reach users at optimal
 *                  time, improving open rates and reducing wasted SMS sends.
 * Risk impact:     None.
 * Verdict:         "defer" if outside active window; "allow" otherwise.
 *
 * Rule ID:  ACTIVE_HOURS_V1
 * Version:  1.0.0
 */

import type { RuleTrace, ConditionTrace, ActionTrace } from "@lixeta/models";
import { MESSAGE_SENT } from "@lixeta/models";
import type { Rule, RuleEvaluationResult } from "../core/rule.js";
import { allowContribution } from "../core/rule.js";
import type { EvaluationContext } from "../core/evaluation-context.js";
import { generateTraceId } from "../utils/id-generator.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ACTIVE_HOURS_RULE_ID = "ACTIVE_HOURS_V1" as const;

const TIMEZONE = "Africa/Lagos"; // WAT = UTC+1
const ACTIVE_HOUR_START = 8;     // 08:00 inclusive
const ACTIVE_HOUR_END = 20;      // 20:59 inclusive (9pm = hour 21 is outside)

// ---------------------------------------------------------------------------
// Time helpers
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

/**
 * Resolve the local hour to evaluate.
 *
 * SIMULATION PRIORITY: if the event payload contains a numeric `hour` field,
 * that value is used directly. This lets callers simulate night-time scenarios
 * (e.g. `{ hour: 2 }`) without manipulating wall-clock time.
 *
 * REAL MODE FALLBACK: derive the WAT hour from the event's ISO timestamp.
 */
function resolveLocalHour(ctx: EvaluationContext): number | null {
  const payload = ctx.event.payload as Record<string, unknown>;
  if (typeof payload["hour"] === "number") {
    const h = payload["hour"];
    if (h >= 0 && h <= 23) return h;
  }
  return getLocalHour(TIMEZONE, ctx.event.timestamp);
}

/**
 * Compute ISO timestamp for next 08:00 WAT.
 * Used as the deferUntil value so the caller knows when to retry.
 */
function nextActiveWindowISO(isoTimestamp: string): string {
  try {
    const now = new Date(isoTimestamp);
    // Compute current date in WAT by formatting then re-parsing
    const watFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const watDate = watFormatter.format(now); // "YYYY-MM-DD"
    // Build 08:00 WAT for today
    const todayAt8 = new Date(`${watDate}T08:00:00+01:00`);
    // If it's already past 08:00 today, use tomorrow
    if (now >= todayAt8) {
      const tomorrow = new Date(todayAt8);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString();
    }
    return todayAt8.toISOString();
  } catch {
    // Fallback: 8 hours from now
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  }
}

// ---------------------------------------------------------------------------
// Rule implementation
// ---------------------------------------------------------------------------

export const activeHoursRule: Rule = {
  id: ACTIVE_HOURS_RULE_ID,
  name: "Active Hours",
  version: "1.0.0",
  description:
    "Defers outbound messages sent outside the 08:00–20:59 WAT active window " +
    "to maximise engagement and avoid wasted notification budget.",

  applies(ctx: EvaluationContext): boolean {
    return ctx.event.type === MESSAGE_SENT;
  },

  evaluate(ctx: EvaluationContext): RuleEvaluationResult {
    const { event } = ctx;
    const traceId = generateTraceId(ACTIVE_HOURS_RULE_ID, event.id);
    const localHour = resolveLocalHour(ctx);

    const isOutsideWindow =
      localHour !== null &&
      (localHour < ACTIVE_HOUR_START || localHour > ACTIVE_HOUR_END);

    const conditions: ConditionTrace[] = [
      {
        description: "event.type === MESSAGE_SENT",
        actualValue: event.type,
        expectedValue: MESSAGE_SENT,
        passed: event.type === MESSAGE_SENT,
      },
      {
        description: `localHour (WAT) is outside active window ${ACTIVE_HOUR_START}:00–${ACTIVE_HOUR_END}:59`,
        actualValue: localHour,
        expectedValue: `< ${ACTIVE_HOUR_START} OR > ${ACTIVE_HOUR_END}`,
        passed: isOutsideWindow,
      },
    ];

    const actions: ActionTrace[] = [];

    if (isOutsideWindow) {
      const deferUntil = nextActiveWindowISO(event.timestamp);

      actions.push({
        actionType: "defer_message",
        description: `Message deferred — local hour ${localHour} (WAT) is outside active window. Will retry at next 08:00 WAT.`,
        executed: true,
        result: {
          localHour,
          timezone: TIMEZONE,
          deferUntil,
          activeWindowStart: ACTIVE_HOUR_START,
          activeWindowEnd: ACTIVE_HOUR_END,
        },
      });

      const trace = buildTrace(
        traceId, ctx, "fired",
        `Message at local hour ${localHour} WAT is outside active window (${ACTIVE_HOUR_START}:00–${ACTIVE_HOUR_END}:59). Deferred to ${deferUntil}.`,
        conditions, actions
      );

      return {
        trace,
        verdictContribution: { type: "defer", until: deferUntil },
      };
    }

    // Within active window — no action needed
    actions.push({
      actionType: "no_action",
      description: `Message within active window (hour ${localHour} WAT) — proceed normally.`,
      executed: true,
      result: { localHour, timezone: TIMEZONE },
    });

    const trace = buildTrace(
      traceId, ctx, "no_match",
      `Message at local hour ${localHour} WAT — within active window. No deferral needed.`,
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
    ruleId: ACTIVE_HOURS_RULE_ID,
    ruleName: "Active Hours",
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
      eventTimestamp: ctx.event.timestamp,
    },
  };
}
