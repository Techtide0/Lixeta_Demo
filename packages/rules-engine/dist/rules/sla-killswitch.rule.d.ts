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
import type { Rule } from "../core/rule.js";
export declare const SLA_KILLSWITCH_RULE_ID: "SLA_KILLSWITCH_V1";
export declare const slaKillswitchRule: Rule;
