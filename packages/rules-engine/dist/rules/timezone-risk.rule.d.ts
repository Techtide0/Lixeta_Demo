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
import type { Rule } from "../core/rule.js";
export declare const TIMEZONE_RISK_RULE_ID: "TIMEZONE_RISK_V1";
export declare const timezoneRiskRule: Rule;
