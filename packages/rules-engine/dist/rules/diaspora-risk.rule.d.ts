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
import type { Rule } from "../core/rule.js";
export declare const DIASPORA_RISK_RULE_ID: "DIASPORA_RISK_V1";
export declare const diasporaRiskRule: Rule;
