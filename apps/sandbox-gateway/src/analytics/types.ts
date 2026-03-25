/**
 * @file analytics/types.ts
 * @description All output types produced by the analytics engine.
 *
 * Design principles
 * ─────────────────
 * • Every field in every type is derived — no manually maintained counters.
 * • Types mirror the API response shape 1:1, so the route handler does zero
 *   reshaping — it calls compute* and returns the result directly.
 * • `currency` is explicit on every monetary field — no implicit NGN assumption.
 * • Breakdowns nest into `*Breakdown` sub-objects so consumers can pick only
 *   what they need without parsing a flat struct.
 * • `derivedAt` marks the computation timestamp — consumers can tell whether
 *   the snapshot is fresh or pre-cached (Stage 6 can optionally cache).
 * • `eventCount` on every aggregate ensures partial-aggregation bugs are caught:
 *   if eventCount !== events.length the consumer knows something is wrong.
 *
 * Audit guarantee: given the same `events[]`, `revenueEvents[]`, `riskEvents[]`,
 * and `ruleTraces[]`, the analytics engine ALWAYS produces the same output.
 */

// ---------------------------------------------------------------------------
// Revenue analytics
// ---------------------------------------------------------------------------

export interface RevenueBreakdown {
  /** Revenue events broken down by category */
  readonly byCategory: Readonly<Record<string, CategoryRevenue>>;
  /** Revenue broken down by event channel (sms, whatsapp, api, …) */
  readonly byChannel: Readonly<Record<string, number>>;
  /** Revenue broken down by the originating domain event type */
  readonly byEventType: Readonly<Record<string, number>>;
  /** Timeline: one entry per calendar day (ISO date string → net minor units) */
  readonly byDay: ReadonlyArray<DailyRevenue>;
}

export interface CategoryRevenue {
  readonly category: string;
  readonly totalGainMinorUnits: number;
  readonly totalLossMinorUnits: number;
  readonly netMinorUnits: number;
  readonly eventCount: number;
  readonly currency: string;
}

export interface DailyRevenue {
  readonly date: string; // YYYY-MM-DD
  readonly gainMinorUnits: number;
  readonly lossMinorUnits: number;
  readonly netMinorUnits: number;
  readonly eventCount: number;
}

export interface RevenueAnalytics {
  readonly totalGainMinorUnits: number;
  readonly totalLossMinorUnits: number;
  readonly netMinorUnits: number;
  /** Net amount expressed as a decimal (minorUnits / multiplier) */
  readonly netAmount: number;
  readonly currency: string;
  readonly minorUnitMultiplier: number;
  readonly totalRevenueEventCount: number;
  readonly gainEventCount: number;
  readonly lossEventCount: number;
  /** Savings specifically (sms_saved, transaction_fee gains, etc.) */
  readonly totalSavingsMinorUnits: number;
  readonly breakdown: RevenueBreakdown;
}

// ---------------------------------------------------------------------------
// Risk analytics
// ---------------------------------------------------------------------------

export interface RiskBreakdown {
  readonly byCategory: Readonly<Record<string, CategoryRisk>>;
  readonly bySeverity: Readonly<Record<string, SeverityRisk>>;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly byDay: ReadonlyArray<DailyRisk>;
}

export interface CategoryRisk {
  readonly category: string;
  readonly count: number;
  readonly averageScore: number;
  readonly maxScore: number;
  readonly totalScore: number;
}

export interface SeverityRisk {
  readonly severity: string;
  readonly count: number;
  readonly averageScore: number;
}

export interface DailyRisk {
  readonly date: string;
  readonly count: number;
  readonly averageScore: number;
  readonly criticalCount: number;
}

export interface RiskAnalytics {
  /** Total number of risk signals raised */
  readonly totalSignalCount: number;
  /** Open signals (not yet resolved) */
  readonly openSignalCount: number;
  /** Critical signals */
  readonly criticalSignalCount: number;
  /** High severity signals */
  readonly highSignalCount: number;
  /** Weighted average risk score across all signals (0.0 – 1.0) */
  readonly averageRiskScore: number;
  /** Maximum risk score observed */
  readonly maxRiskScore: number;
  /**
   * Composite exposure score: average of all open signal scores.
   * 0.0 = no risk, 1.0 = maximum exposure.
   */
  readonly riskExposureScore: number;
  readonly breakdown: RiskBreakdown;
}

// ---------------------------------------------------------------------------
// Rules analytics
// ---------------------------------------------------------------------------

export interface RulePerformance {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly ruleVersion: string;
  readonly firedCount: number;
  readonly skippedCount: number;
  readonly errorCount: number;
  readonly noMatchCount: number;
  readonly totalEvaluationCount: number;
  readonly fireRate: number;        // firedCount / totalEvaluationCount
  readonly errorRate: number;       // errorCount / totalEvaluationCount
  readonly averageExecutionMs: number;
  readonly maxExecutionMs: number;
  readonly totalExecutionMs: number;
}

export interface VerdictDistribution {
  readonly allow: number;
  readonly block: number;
  readonly flag: number;
  readonly transform: number;
  readonly defer: number;
  readonly error: number;
  readonly total: number;
}

export interface RulesAnalytics {
  readonly totalTracesEvaluated: number;
  readonly totalRulesFired: number;
  readonly totalRulesSkipped: number;
  readonly totalRuleErrors: number;
  readonly uniqueRulesInvoked: number;
  readonly averageExecutionMsPerEvent: number;
  readonly verdictDistribution: VerdictDistribution;
  /** Per-rule performance, sorted by firedCount descending */
  readonly rulePerformance: ReadonlyArray<RulePerformance>;
}

// ---------------------------------------------------------------------------
// Event analytics
// ---------------------------------------------------------------------------

export interface EventTypeCount {
  readonly eventType: string;
  readonly count: number;
  readonly percentage: number;
}

export interface EventAnalytics {
  readonly totalEventCount: number;
  readonly uniqueEventTypes: number;
  readonly byType: ReadonlyArray<EventTypeCount>;
  readonly byHour: ReadonlyArray<HourlyEventCount>;
  readonly averageEventsPerHour: number;
  readonly firstEventAt: string | null;
  readonly lastEventAt: string | null;
  readonly sessionDurationMs: number | null;
}

export interface HourlyEventCount {
  readonly hour: string; // ISO hour bucket: "2026-03-19T14:00:00.000Z"
  readonly count: number;
}

// ---------------------------------------------------------------------------
// KPI summary — the top-level card data for the dashboard
// ---------------------------------------------------------------------------

export interface KpiSummary {
  /** Net revenue in minor units (kobo, cents, etc.) */
  readonly netRevenueMinorUnits: number;
  /** Net revenue as decimal */
  readonly netRevenueAmount: number;
  /** Total savings (gain-direction revenue) in minor units */
  readonly totalSavingsMinorUnits: number;
  /** Total cost (loss-direction revenue) in minor units */
  readonly totalCostMinorUnits: number;
  /** Number of open risk signals */
  readonly openRiskSignals: number;
  /** Composite risk exposure 0.0–1.0 */
  readonly riskExposureScore: number;
  /** Total rules fired across all events */
  readonly rulesFiredCount: number;
  /** Total events processed in this session */
  readonly totalEvents: number;
  /** Number of flagged decisions */
  readonly flaggedDecisions: number;
  /** Number of blocked decisions */
  readonly blockedDecisions: number;
  /** Decision accuracy: (allow+flag) / total (excludes engine errors) */
  readonly decisionSuccessRate: number;
  readonly currency: string;
}

// ---------------------------------------------------------------------------
// Full session analytics — the root type returned by the API
// ---------------------------------------------------------------------------

export interface SessionAnalytics {
  readonly sessionId: string;
  readonly sessionStatus: string;
  readonly derivedAt: string;        // ISO 8601 — when this computation ran
  readonly kpi: KpiSummary;
  readonly revenue: RevenueAnalytics;
  readonly risk: RiskAnalytics;
  readonly rules: RulesAnalytics;
  readonly events: EventAnalytics;
}

// ---------------------------------------------------------------------------
// Multi-session analytics (for GET /analytics?sessionId=a,b,c)
// ---------------------------------------------------------------------------

export interface MultiSessionAnalytics {
  readonly sessions: ReadonlyArray<SessionAnalytics>;
  readonly aggregate: AggregateAnalytics;
  readonly derivedAt: string;
  readonly sessionCount: number;
}

export interface AggregateAnalytics {
  readonly totalNetRevenueMinorUnits: number;
  readonly totalSavingsMinorUnits: number;
  readonly totalCostMinorUnits: number;
  readonly totalEvents: number;
  readonly totalRiskSignals: number;
  readonly totalRulesFired: number;
  readonly averageRiskExposureScore: number;
  readonly currency: string;
}
