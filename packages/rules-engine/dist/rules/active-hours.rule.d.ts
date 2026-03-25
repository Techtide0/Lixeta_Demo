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
import type { Rule } from "../core/rule.js";
export declare const ACTIVE_HOURS_RULE_ID: "ACTIVE_HOURS_V1";
export declare const activeHoursRule: Rule;
