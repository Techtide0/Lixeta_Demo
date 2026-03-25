/**
 * @file analytics/engine.ts
 * @description Analytics engine — the single orchestration point.
 *
 * `computeSessionAnalytics` is the entry point for the API route.
 * It calls the four sub-computers and assembles the final `SessionAnalytics`
 * object, including the KPI summary that the dashboard renders directly.
 *
 * `computeMultiSessionAnalytics` handles the multi-session case for
 * GET /analytics?sessionId=a,b,c — it runs per-session analytics and
 * then derives cross-session aggregate numbers.
 *
 * Immutability guarantee
 * ──────────────────────
 * This module reads `SessionRecord.state` but never writes to it.
 * There is no caching layer here — every call produces a fresh computation.
 * Stage 6 may introduce a memoisation layer above this if performance requires.
 *
 * Security note
 * ─────────────
 * This module never reads from the session store directly. It accepts a
 * `SimulationState` as a parameter so callers (the route handler) remain
 * responsible for session ID validation and access control.
 * Analytics cannot leak data across sessions because it has no store reference.
 */

import type { SimulationState, DecisionResult } from "../../../../packages/models/src/index.js";
import type {
  SessionAnalytics,
  MultiSessionAnalytics,
  AggregateAnalytics,
  KpiSummary,
} from "./types.js";
import { computeRevenue } from "./compute-revenue.js";
import { computeRisk } from "./compute-risk.js";
import { computeRules } from "./compute-rules.js";
import { computeEvents } from "./compute-events.js";

// ---------------------------------------------------------------------------
// Single session
// ---------------------------------------------------------------------------

/**
 * Derive the full analytics snapshot for one session.
 *
 * @param sessionId     The session ID (for labelling — not used for lookup)
 * @param sessionStatus The current session lifecycle status
 * @param state         The session's accumulated SimulationState
 * @param multiplier    Minor unit multiplier (100 for NGN/USD, 1 for JPY)
 *
 * Error handling: if a specific metric type is unavailable or computation fails,
 * that metric is replaced with a minimal fallback and a `failedMetrics` array
 * is added to the response indicating which types failed to load.
 */
export function computeSessionAnalytics(
  sessionId: string,
  sessionStatus: string,
  state: SimulationState,
  multiplier = 100
): SessionAnalytics {
  const failedMetrics: string[] = [];

  let revenue;
  try {
    revenue = computeRevenue(state.revenueEvents, multiplier);
  } catch (err) {
    failedMetrics.push("revenue");
    revenue = getEmptyRevenueAnalytics(multiplier);
  }

  let risk;
  try {
    risk = computeRisk(state.riskEvents);
  } catch (err) {
    failedMetrics.push("risk");
    risk = getEmptyRiskAnalytics();
  }

  let rules;
  try {
    rules = computeRules(state.ruleTraces, state.decisions);
  } catch (err) {
    failedMetrics.push("rules");
    rules = getEmptyRulesAnalytics();
  }

  let events;
  try {
    events = computeEvents(state.events);
  } catch (err) {
    failedMetrics.push("events");
    events = getEmptyEventAnalytics();
  }

  const kpi = deriveKpi(revenue.totalSavingsMinorUnits, revenue.totalLossMinorUnits, revenue.netMinorUnits, revenue.netAmount, risk, rules, events, state.decisions, revenue.currency, multiplier);

  const result: SessionAnalytics = {
    sessionId,
    sessionStatus,
    derivedAt: new Date().toISOString(),
    kpi,
    revenue,
    risk,
    rules,
    events,
  };

  // Attach failed metrics information if any computation failed
  if (failedMetrics.length > 0) {
    (result as any)["failedMetrics"] = failedMetrics;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Multi-session
// ---------------------------------------------------------------------------

export interface SessionInput {
  readonly sessionId: string;
  readonly sessionStatus: string;
  readonly state: SimulationState;
}

/**
 * Derive analytics for multiple sessions and build an aggregate summary.
 */
export function computeMultiSessionAnalytics(
  sessions: ReadonlyArray<SessionInput>,
  multiplier = 100
): MultiSessionAnalytics {
  const perSession = sessions.map((s) =>
    computeSessionAnalytics(s.sessionId, s.sessionStatus, s.state, multiplier)
  );

  const aggregate = deriveAggregate(perSession);

  return {
    sessions: perSession,
    aggregate,
    derivedAt: new Date().toISOString(),
    sessionCount: sessions.length,
  };
}

// ---------------------------------------------------------------------------
// KPI derivation
// ---------------------------------------------------------------------------

function deriveKpi(
  totalSavings: number,
  totalCost: number,
  netMinorUnits: number,
  netAmount: number,
  risk: ReturnType<typeof computeRisk>,
  rules: ReturnType<typeof computeRules>,
  events: ReturnType<typeof computeEvents>,
  decisions: Readonly<Record<string, DecisionResult>>,
  currency: string,
  multiplier: number,
): KpiSummary {
  const decisionValues = Object.values(decisions);
  const totalDecisions = decisionValues.length;

  let flagged = 0;
  let blocked = 0;
  let engineErrors = 0;

  for (const d of decisionValues) {
    if (d.verdict === "flag") flagged++;
    if (d.verdict === "block") blocked++;
    if (d.verdict === "error") engineErrors++;
  }

  const successRate = totalDecisions > 0
    ? roundTo4((totalDecisions - engineErrors) / totalDecisions)
    : 1.0;

  return {
    netRevenueMinorUnits: netMinorUnits,
    netRevenueAmount: netAmount,
    totalSavingsMinorUnits: totalSavings,
    totalCostMinorUnits: totalCost,
    openRiskSignals: risk.openSignalCount,
    riskExposureScore: risk.riskExposureScore,
    rulesFiredCount: rules.totalRulesFired,
    totalEvents: events.totalEventCount,
    flaggedDecisions: flagged,
    blockedDecisions: blocked,
    decisionSuccessRate: successRate,
    currency,
  };
}

// ---------------------------------------------------------------------------
// Aggregate across sessions
// ---------------------------------------------------------------------------

function deriveAggregate(
  sessions: ReadonlyArray<SessionAnalytics>
): AggregateAnalytics {
  if (sessions.length === 0) {
    return {
      totalNetRevenueMinorUnits: 0,
      totalSavingsMinorUnits: 0,
      totalCostMinorUnits: 0,
      totalEvents: 0,
      totalRiskSignals: 0,
      totalRulesFired: 0,
      averageRiskExposureScore: 0,
      currency: "NGN",
    };
  }

  let netRevenue = 0;
  let savings = 0;
  let cost = 0;
  let totalEvents = 0;
  let totalRisk = 0;
  let totalFired = 0;
  let exposureSum = 0;

  // Use most common currency as aggregate currency
  const currencyCounts = new Map<string, number>();

  for (const s of sessions) {
    netRevenue  += s.revenue.netMinorUnits;
    savings     += s.revenue.totalSavingsMinorUnits;
    cost        += s.revenue.totalLossMinorUnits;
    totalEvents += s.events.totalEventCount;
    totalRisk   += s.risk.totalSignalCount;
    totalFired  += s.rules.totalRulesFired;
    exposureSum += s.risk.riskExposureScore;
    currencyCounts.set(s.revenue.currency, (currencyCounts.get(s.revenue.currency) ?? 0) + 1);
  }

  let primaryCurrency = "NGN";
  let maxCount = 0;
  for (const [cur, count] of currencyCounts) {
    if (count > maxCount) { maxCount = count; primaryCurrency = cur; }
  }

  return {
    totalNetRevenueMinorUnits: netRevenue,
    totalSavingsMinorUnits: savings,
    totalCostMinorUnits: cost,
    totalEvents,
    totalRiskSignals: totalRisk,
    totalRulesFired: totalFired,
    averageRiskExposureScore: roundTo4(exposureSum / sessions.length),
    currency: primaryCurrency,
  };
}

// ---------------------------------------------------------------------------
// Fallback/Empty Structures (for when a type isn't available)
// ---------------------------------------------------------------------------

function getEmptyRevenueAnalytics(multiplier = 100): ReturnType<typeof computeRevenue> {
  return {
    totalGainMinorUnits: 0,
    totalLossMinorUnits: 0,
    netMinorUnits: 0,
    netAmount: 0,
    currency: "NGN",
    minorUnitMultiplier: multiplier,
    totalRevenueEventCount: 0,
    gainEventCount: 0,
    lossEventCount: 0,
    totalSavingsMinorUnits: 0,
    breakdown: {
      byCategory: {},
      byChannel: {},
      byEventType: {},
      byDay: [],
    },
  };
}

function getEmptyRiskAnalytics(): ReturnType<typeof computeRisk> {
  return {
    totalSignalCount: 0,
    openSignalCount: 0,
    criticalSignalCount: 0,
    highSignalCount: 0,
    averageRiskScore: 0,
    maxRiskScore: 0,
    riskExposureScore: 0,
    breakdown: {
      byCategory: {},
      bySeverity: {},
      byStatus: {},
      byDay: [],
    },
  };
}

function getEmptyRulesAnalytics(): ReturnType<typeof computeRules> {
  return {
    totalTracesEvaluated: 0,
    totalRulesFired: 0,
    totalRulesSkipped: 0,
    totalRuleErrors: 0,
    uniqueRulesInvoked: 0,
    averageExecutionMsPerEvent: 0,
    verdictDistribution: {
      allow: 0,
      block: 0,
      flag: 0,
      transform: 0,
      defer: 0,
      error: 0,
      total: 0,
    },
    rulePerformance: [],
  };
}

function getEmptyEventAnalytics(): ReturnType<typeof computeEvents> {
  return {
    totalEventCount: 0,
    uniqueEventTypes: 0,
    byType: [],
    byHour: [],
    averageEventsPerHour: 0,
    firstEventAt: null,
    lastEventAt: null,
    sessionDurationMs: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundTo4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
