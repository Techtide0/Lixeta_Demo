/**
 * @file analytics/compute-rules.ts
 * @description Pure, deterministic rules analytics derivation.
 *
 * Computes per-rule performance metrics and aggregate verdict distribution
 * from the raw `ruleTraces[]` and `decisions` map in SimulationState.
 *
 * Fire-rate formula
 * ─────────────────
 * fireRate = firedCount / totalEvaluationCount
 *
 * A rule with fireRate=1.0 applies to every event it's invoked on.
 * A rule with fireRate=0.0 is enabled but never matches — review or disable it.
 * errorRate > 0.05 (5%) should trigger a rule-health alert.
 *
 * Average execution time is computed only over "fired" + "no_match" traces
 * (error traces may have partial execution times that skew the average).
 */

import type { RuleTrace, DecisionResult } from "@lixeta/models";
import type {
  RulesAnalytics,
  RulePerformance,
  VerdictDistribution,
} from "./types.js";

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

export function computeRules(
  ruleTraces: ReadonlyArray<RuleTrace>,
  decisions: Readonly<Record<string, DecisionResult>>
): RulesAnalytics {
  if (ruleTraces.length === 0) {
    return emptyRules(decisions);
  }

  // Per-rule aggregation
  const ruleMap = new Map<string, {
    name: string; version: string;
    fired: number; skipped: number; error: number; noMatch: number;
    execMsTotal: number; execMsMax: number; execMsCount: number;
  }>();

  let totalFired = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalExecMs = 0;
  let totalExecCount = 0;

  for (const trace of ruleTraces) {
    const existing = ruleMap.get(trace.ruleId) ?? {
      name: trace.ruleName,
      version: trace.ruleVersion,
      fired: 0, skipped: 0, error: 0, noMatch: 0,
      execMsTotal: 0, execMsMax: 0, execMsCount: 0,
    };

    switch (trace.outcome) {
      case "fired":
        existing.fired++;
        totalFired++;
        break;
      case "skipped":
      case "disabled":
        existing.skipped++;
        totalSkipped++;
        break;
      case "error":
        existing.error++;
        totalErrors++;
        break;
      case "no_match":
        existing.noMatch++;
        break;
    }

    // Only include non-zero execution times
    if (trace.executionTimeMs > 0 && trace.outcome !== "error") {
      existing.execMsTotal += trace.executionTimeMs;
      existing.execMsMax = Math.max(existing.execMsMax, trace.executionTimeMs);
      existing.execMsCount++;
      totalExecMs += trace.executionTimeMs;
      totalExecCount++;
    }

    ruleMap.set(trace.ruleId, existing);
  }

  // Build per-rule performance array, sorted by firedCount desc
  const rulePerformance: RulePerformance[] = [];
  for (const [ruleId, data] of ruleMap) {
    const total = data.fired + data.skipped + data.error + data.noMatch;
    rulePerformance.push({
      ruleId,
      ruleName: data.name,
      ruleVersion: data.version,
      firedCount: data.fired,
      skippedCount: data.skipped,
      errorCount: data.error,
      noMatchCount: data.noMatch,
      totalEvaluationCount: total,
      fireRate: total > 0 ? roundTo4(data.fired / total) : 0,
      errorRate: total > 0 ? roundTo4(data.error / total) : 0,
      averageExecutionMs: data.execMsCount > 0
        ? roundTo4(data.execMsTotal / data.execMsCount)
        : 0,
      maxExecutionMs: data.execMsMax,
      totalExecutionMs: roundTo4(data.execMsTotal),
    });
  }
  rulePerformance.sort((a, b) => b.firedCount - a.firedCount);

  // Verdict distribution from decisions map
  const verdictDist = computeVerdictDistribution(decisions);

  // Average execution time per event (total exec / number of unique events)
  const uniqueEventCount = new Set(ruleTraces.map((t) => t.triggeringEventId)).size;
  const avgExecMsPerEvent = uniqueEventCount > 0
    ? roundTo4(totalExecMs / uniqueEventCount)
    : 0;

  return {
    totalTracesEvaluated: ruleTraces.length,
    totalRulesFired: totalFired,
    totalRulesSkipped: totalSkipped,
    totalRuleErrors: totalErrors,
    uniqueRulesInvoked: ruleMap.size,
    averageExecutionMsPerEvent: avgExecMsPerEvent,
    verdictDistribution: verdictDist,
    rulePerformance,
  };
}

// ---------------------------------------------------------------------------
// Verdict distribution
// ---------------------------------------------------------------------------

function computeVerdictDistribution(
  decisions: Readonly<Record<string, DecisionResult>>
): VerdictDistribution {
  let allow = 0, block = 0, flag = 0, transform = 0, defer = 0, error = 0;

  for (const decision of Object.values(decisions)) {
    switch (decision.verdict) {
      case "allow":     allow++;     break;
      case "block":     block++;     break;
      case "flag":      flag++;      break;
      case "transform": transform++; break;
      case "defer":     defer++;     break;
      case "error":     error++;     break;
    }
  }

  const total = allow + block + flag + transform + defer + error;
  return { allow, block, flag, transform, defer, error, total };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundTo4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function emptyRules(
  decisions: Readonly<Record<string, DecisionResult>>
): RulesAnalytics {
  return {
    totalTracesEvaluated: 0,
    totalRulesFired: 0,
    totalRulesSkipped: 0,
    totalRuleErrors: 0,
    uniqueRulesInvoked: 0,
    averageExecutionMsPerEvent: 0,
    verdictDistribution: computeVerdictDistribution(decisions),
    rulePerformance: [],
  };
}
