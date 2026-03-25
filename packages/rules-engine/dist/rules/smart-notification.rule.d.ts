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
import type { Rule } from "../core/rule.js";
export declare const SMART_NOTIFICATION_RULE_ID: "SMART_NOTIFICATION_V1";
export declare const smartNotificationRule: Rule;
