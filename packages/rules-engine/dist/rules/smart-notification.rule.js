/**
 * @file smart-notification.rule.ts
 * @description Smart Notification Rule
 *
 * Business Logic
 * ──────────────
 * When a "message.sent" event arrives and the recipient's app session is
 * currently open (indicated by `state.appOpen`), the SMS channel is
 * suppressed in favour of an in-app push. This avoids billing an SMS when a
 * free in-app notification achieves the same outcome.
 *
 * Revenue impact:  +400 kobo (≈ ₦4) saved per suppressed SMS.
 * Risk impact:     None (suppressing SMS to an active user is expected behaviour).
 * Verdict:         "allow" — the message is still delivered, just via a cheaper channel.
 *
 * Extended logic
 * ──────────────
 * The rule also handles the inverse: if the app is CLOSED, it emits a
 * different revenue event ("sms_cost" direction = "loss") to track spend —
 * useful for analytics even when the rule does not suppress anything.
 *
 * Rule ID:  SMART_NOTIFICATION_V1
 * Version:  1.2.0
 */
import { MESSAGE_SENT, } from "@lixeta/models";
import { allowContribution, noOpinion } from "../core/rule.js";
import { generateTraceId } from "../utils/id-generator.js";
import { generateRevenueEventId } from "../utils/id-generator.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const SMART_NOTIFICATION_RULE_ID = "SMART_NOTIFICATION_V1";
/** Cost of one SMS in kobo (NGN minor units). 1000 kobo = ₦10. */
const SMS_COST_KOBO = 1_000;
// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------
const ACTIVE_HOUR_START = 8;
const ACTIVE_HOUR_END = 20;
/**
 * Extract appOpen from the event payload.
 * Defaults to false (conservative: assume app is closed).
 */
function resolveAppOpen(ctx) {
    const payload = ctx.event.payload;
    const appOpenValue = payload["appOpen"];
    if (typeof appOpenValue === "boolean")
        return appOpenValue;
    return false;
}
/**
 * Check whether this message would be deferred by the Active Hours rule.
 * If payload.hour is supplied (simulation mode), use it directly.
 * Fallback: derive hour from event.timestamp in WAT (Africa/Lagos, UTC+1).
 * Returns true only if we can CONFIRM outside window — never blocks on doubt.
 */
function wouldBeDeferred(ctx) {
    const payload = ctx.event.payload;
    let localHour = null;
    if (typeof payload["hour"] === "number") {
        const h = payload["hour"];
        if (h >= 0 && h <= 23)
            localHour = h;
    }
    if (localHour === null) {
        try {
            const date = new Date(ctx.event.timestamp);
            const formatter = new Intl.DateTimeFormat("en-US", {
                hour: "numeric", hour12: false, timeZone: "Africa/Lagos",
            });
            const parts = formatter.formatToParts(date);
            const hp = parts.find((p) => p.type === "hour");
            if (hp)
                localHour = parseInt(hp.value, 10) || null;
        }
        catch { /* ignore — don't block on timezone errors */ }
    }
    if (localHour === null)
        return false;
    return localHour < ACTIVE_HOUR_START || localHour > ACTIVE_HOUR_END;
}
// ---------------------------------------------------------------------------
// Rule implementation
// ---------------------------------------------------------------------------
export const smartNotificationRule = {
    id: SMART_NOTIFICATION_RULE_ID,
    name: "Smart Notification",
    version: "1.2.0",
    description: "Suppresses SMS billing when the recipient has the app open, switching to " +
        "a free in-app notification. Tracks SMS cost when the app is closed.",
    // ── applies ──────────────────────────────────────────────────────────────
    applies(ctx) {
        // Only relevant for outbound messages
        return ctx.event.type === MESSAGE_SENT;
    },
    // ── evaluate ─────────────────────────────────────────────────────────────
    evaluate(ctx) {
        const { event, config } = ctx;
        const traceId = generateTraceId(SMART_NOTIFICATION_RULE_ID, event.id);
        const appOpen = resolveAppOpen(ctx);
        // If Active Hours will defer this message, no SMS is sent/suppressed yet —
        // recording a cost or gain now would be premature and incorrect.
        if (wouldBeDeferred(ctx)) {
            const trace = buildTrace(traceId, ctx, "no_match", "Message is outside active hours — will be deferred. No revenue impact recorded.", [
                {
                    description: "event.type === MESSAGE_SENT",
                    actualValue: event.type,
                    expectedValue: MESSAGE_SENT,
                    passed: true,
                },
                {
                    description: "Message is outside active hours window — deferral pending",
                    actualValue: "outside_window",
                    expectedValue: "within_window",
                    passed: false,
                },
            ], []);
            return { trace, verdictContribution: noOpinion() };
        }
        // ── conditions ──
        const conditions = [
            {
                description: "event.type === MESSAGE_SENT",
                actualValue: event.type,
                expectedValue: MESSAGE_SENT,
                passed: event.type === MESSAGE_SENT,
            },
            {
                description: "event.payload.appOpen === true",
                actualValue: appOpen,
                expectedValue: true,
                passed: appOpen,
            },
        ];
        const actions = [];
        if (appOpen) {
            // ── App IS open: suppress SMS, emit revenue gain ──
            const revenueId = generateRevenueEventId(event.id, SMART_NOTIFICATION_RULE_ID);
            ctx.emitRevenue({
                triggeringEventId: event.id,
                triggeringEventType: event.type,
                triggeringRuleId: SMART_NOTIFICATION_RULE_ID,
                triggeringRuleName: "Smart Notification",
                category: "sms_saved",
                direction: "gain",
                amount: {
                    amountMinorUnits: SMS_COST_KOBO,
                    currency: config.revenue.currency,
                },
                description: "SMS suppressed — user app is open; delivered via in-app notification",
                metadata: {
                    originalChannel: event.source.channel,
                    suppressedChannel: "sms",
                    substituteChannel: "in_app",
                    ruleVersion: "1.2.0",
                },
            });
            actions.push({
                actionType: "suppress_sms",
                description: "Suppressed SMS billing; routed to in-app notification",
                executed: true,
                result: {
                    savedAmountKobo: SMS_COST_KOBO,
                    currency: config.revenue.currency,
                    substituteChannel: "in_app",
                },
            });
            const trace = buildTrace(traceId, ctx, "fired", `App is open — SMS suppressed. ₦${(SMS_COST_KOBO / 100).toFixed(2)} saved.`, conditions, actions);
            return { trace, verdictContribution: allowContribution() };
        }
        else {
            // ── App is CLOSED: SMS will be sent; track the cost ──
            ctx.emitRevenue({
                triggeringEventId: event.id,
                triggeringEventType: event.type,
                triggeringRuleId: SMART_NOTIFICATION_RULE_ID,
                triggeringRuleName: "Smart Notification",
                category: "sms_cost",
                direction: "loss",
                amount: {
                    amountMinorUnits: SMS_COST_KOBO,
                    currency: config.revenue.currency,
                },
                description: "SMS sent — app is closed; cost recorded",
                metadata: {
                    originalChannel: event.source.channel,
                    sentChannel: "sms",
                    ruleVersion: "1.2.0",
                },
            });
            actions.push({
                actionType: "record_sms_cost",
                description: "App closed — SMS will be delivered; cost tracked",
                executed: true,
                result: {
                    costKobo: SMS_COST_KOBO,
                    currency: config.revenue.currency,
                },
            });
            // outcome = "fired" because the rule actively executed an action
            // (recording sms_cost). "no_match" would mean the rule did nothing.
            const trace = buildTrace(traceId, ctx, "fired", "App is closed — SMS will be sent normally. Cost recorded for analytics.", conditions, actions);
            return { trace, verdictContribution: noOpinion() };
        }
    },
};
// ---------------------------------------------------------------------------
// Trace builder
// ---------------------------------------------------------------------------
function buildTrace(traceId, ctx, outcome, explanation, conditions, actions) {
    const snapshot = {
        eventId: ctx.event.id,
        eventType: ctx.event.type,
        sourceChannel: ctx.event.source.channel,
        sequence: ctx.evaluationSequence,
    };
    if (ctx.config.security.capturePayloadSnapshot) {
        snapshot["payload"] = ctx.event.payload;
        snapshot["simulationStatus"] = ctx.state.status;
    }
    return {
        traceId,
        ruleId: SMART_NOTIFICATION_RULE_ID,
        ruleName: "Smart Notification",
        ruleVersion: "1.2.0",
        triggeringEventId: ctx.event.id,
        triggeringEventType: ctx.event.type,
        evaluatedAt: ctx.batchTimestamp,
        executionTimeMs: 0, // set by harness post-hoc
        outcome,
        explanation,
        conditions,
        actions,
        contextSnapshot: snapshot,
    };
}
