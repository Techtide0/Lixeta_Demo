/**
 * @file analytics/compute-risk.ts
 * @description Pure, deterministic risk analytics derivation.
 *
 * Exposure score formula
 * ──────────────────────
 * riskExposureScore = weighted average of OPEN signal scores,
 * where weight = severityWeight[severity].
 *
 * Severity weights: critical=4, high=3, medium=2, low=1.
 *
 * This gives a composite 0.0–1.0 score that represents current actual exposure
 * (resolved/dismissed signals do not contribute). An exposure of 0.75+ should
 * trigger a human review alert in Stage 6.
 *
 * All inputs are treated as immutable — this function reads but never writes.
 */

import type { RiskEvent } from "../../../../packages/models/src/index.js";
import type {
  RiskAnalytics,
  RiskBreakdown,
  CategoryRisk,
  SeverityRisk,
  DailyRisk,
} from "./types.js";

// ---------------------------------------------------------------------------
// Severity weights for exposure score
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const OPEN_STATUSES = new Set(["open", "reviewing", "escalated"]);

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

export function computeRisk(
  riskEvents: ReadonlyArray<RiskEvent>
): RiskAnalytics {
  if (riskEvents.length === 0) {
    return emptyRisk();
  }

  let criticalCount = 0;
  let highCount = 0;
  let openCount = 0;
  let totalScore = 0;
  let maxScore = 0;

  // For exposure: weight-sum and weight-total of OPEN signals
  let weightedScoreSum = 0;
  let weightTotal = 0;

  const categoryMap = new Map<string, { count: number; scoreSum: number; maxScore: number }>();
  const severityMap = new Map<string, { count: number; scoreSum: number }>();
  const statusMap = new Map<string, number>();
  const dayMap = new Map<string, { count: number; scoreSum: number; criticalCount: number }>();

  for (const event of riskEvents) {
    const score = clampScore(event.score);
    totalScore += score;
    maxScore = Math.max(maxScore, score);

    if (event.severity === "critical") criticalCount++;
    if (event.severity === "high") highCount++;

    if (OPEN_STATUSES.has(event.status)) {
      openCount++;
      const weight = SEVERITY_WEIGHT[event.severity] ?? 1;
      weightedScoreSum += score * weight;
      weightTotal += weight;
    }

    // Category
    const cat = categoryMap.get(event.category) ?? { count: 0, scoreSum: 0, maxScore: 0 };
    categoryMap.set(event.category, {
      count: cat.count + 1,
      scoreSum: cat.scoreSum + score,
      maxScore: Math.max(cat.maxScore, score),
    });

    // Severity
    const sev = severityMap.get(event.severity) ?? { count: 0, scoreSum: 0 };
    severityMap.set(event.severity, { count: sev.count + 1, scoreSum: sev.scoreSum + score });

    // Status
    statusMap.set(event.status, (statusMap.get(event.status) ?? 0) + 1);

    // Day
    const day = event.detectedAt.substring(0, 10);
    const dayEntry = dayMap.get(day) ?? { count: 0, scoreSum: 0, criticalCount: 0 };
    dayMap.set(day, {
      count: dayEntry.count + 1,
      scoreSum: dayEntry.scoreSum + score,
      criticalCount: dayEntry.criticalCount + (event.severity === "critical" ? 1 : 0),
    });
  }

  const n = riskEvents.length;
  const averageScore = n > 0 ? roundToDecimals(totalScore / n, 4) : 0;
  const riskExposureScore = weightTotal > 0
    ? roundToDecimals(weightedScoreSum / weightTotal, 4)
    : 0;

  // Build breakdown sub-objects
  const byCategory: Record<string, CategoryRisk> = {};
  for (const [cat, data] of categoryMap) {
    byCategory[cat] = {
      category: cat,
      count: data.count,
      averageScore: roundToDecimals(data.scoreSum / data.count, 4),
      maxScore: data.maxScore,
      totalScore: roundToDecimals(data.scoreSum, 4),
    };
  }

  const bySeverity: Record<string, SeverityRisk> = {};
  for (const [sev, data] of severityMap) {
    bySeverity[sev] = {
      severity: sev,
      count: data.count,
      averageScore: roundToDecimals(data.scoreSum / data.count, 4),
    };
  }

  const byStatus: Record<string, number> = {};
  for (const [status, count] of statusMap) byStatus[status] = count;

  const byDay: DailyRisk[] = [];
  for (const [date, data] of [...dayMap].sort(([a], [b]) => a.localeCompare(b))) {
    byDay.push({
      date,
      count: data.count,
      averageScore: roundToDecimals(data.scoreSum / data.count, 4),
      criticalCount: data.criticalCount,
    });
  }

  const breakdown: RiskBreakdown = { byCategory, bySeverity, byStatus, byDay };

  return {
    totalSignalCount: n,
    openSignalCount: openCount,
    criticalSignalCount: criticalCount,
    highSignalCount: highCount,
    averageRiskScore: averageScore,
    maxRiskScore: maxScore,
    riskExposureScore,
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampScore(score: unknown): number {
  if (typeof score !== "number" || isNaN(score)) return 0;
  return Math.min(1, Math.max(0, score));
}

function roundToDecimals(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function emptyRisk(): RiskAnalytics {
  return {
    totalSignalCount: 0,
    openSignalCount: 0,
    criticalSignalCount: 0,
    highSignalCount: 0,
    averageRiskScore: 0,
    maxRiskScore: 0,
    riskExposureScore: 0,
    breakdown: { byCategory: {}, bySeverity: {}, byStatus: {}, byDay: [] },
  };
}
