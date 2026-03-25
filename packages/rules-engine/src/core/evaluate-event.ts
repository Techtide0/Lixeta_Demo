/**
 * @file evaluate-event.ts
 * @description The engine's main entry point.
 *
 * `evaluateEvent` is a pure function:
 *   Input:  DomainEvent + SimulationState + EngineConfig
 *   Output: EngineEvaluationOutput (DecisionResult + revenue + risk + traces)
 *
 * The function NEVER mutates its inputs. All outputs are fresh immutable
 * objects. State accumulation is the responsibility of the simulation system
 * (Stage 4), not the engine.
 *
 * Pipeline (in order)
 * ───────────────────
 * 1. Input validation (basic shape check)
 * 2. Security guard (source, channel, payload size, sanitisation)
 * 3. Context construction
 * 4. Rule iteration (via harness — timeout + error isolation per rule)
 * 5. Verdict merge (highest-priority contribution wins)
 * 6. Output assembly (DecisionResult + revenue[] + risk[] + traces[])
 *
 * Security notes
 * ──────────────
 * • The engine is re-entrant and stateless between calls. No module-level
 *   mutable state is read or written during evaluation (the registry is
 *   read-only after freeze).
 * • All emitted IDs are generated deterministically — the same event through
 *   the same config produces the same output IDs, enabling idempotent replay.
 * • `performance.now()` is used for timing — it is monotonic and cannot be
 *   spoofed by changing the system clock.
 */

import type {
  DomainEvent,
  SimulationState,
  DecisionResult,
  RevenueEvent,
  RiskEvent,
  RuleTrace,
  AppliedAction,
  RuleTraceSummary,
} from "@lixeta/models";

import { assertDomainEvent } from "@lixeta/models";

import type { EngineConfig } from "./engine-config.js";
import type { EvaluationContext, EmitRevenueFn, EmitRiskFn } from "./evaluation-context.js";
import { runSecurityGuard } from "../security/security-guard.js";
import { getEnabledRules } from "../registry/rule-registry.js";
import { invokeRule } from "./rule-harness.js";
import { mergeVerdicts } from "./rule.js";
import type { VerdictContribution } from "./rule.js";
import {
  generateDecisionId,
  generateRevenueEventId,
  generateRiskEventId,
} from "../utils/id-generator.js";

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

/**
 * The complete output of one `evaluateEvent` call.
 *
 * This is what the backend / simulation system receives and uses to:
 *   • Return a decision to the caller
 *   • Accumulate state (Stage 4)
 *   • Persist to the event store
 *   • Feed the analytics pipeline
 */
export interface EngineEvaluationOutput {
  readonly decision: DecisionResult;
  readonly revenueEvents: ReadonlyArray<RevenueEvent>;
  readonly riskEvents: ReadonlyArray<RiskEvent>;
  readonly ruleTraces: ReadonlyArray<RuleTrace>;
  /**
   * True if trace output was truncated due to `maxTraceRecords`.
   * The backend should log this as a warning.
   */
  readonly traceTruncated: boolean;
}

// ---------------------------------------------------------------------------
// Evaluation metadata — carries context not visible to individual rules
// ---------------------------------------------------------------------------

interface EvalMeta {
  readonly startTime: number;
  readonly batchTimestamp: string;
  readonly decisionId: string;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Evaluate a single domain event through the rules engine.
 *
 * This function is synchronous and deterministic. It never throws — all
 * errors are captured and returned as an "error" verdict in the output.
 *
 * @param rawEvent  The event to evaluate (will be validated + sanitised)
 * @param state     Current simulation state (read-only view)
 * @param config    Active engine configuration
 */
export function evaluateEvent(
  rawEvent: unknown,
  state: Readonly<SimulationState>,
  config: Readonly<EngineConfig>
): EngineEvaluationOutput {
  const startTime = performance.now();
  const batchTimestamp = new Date().toISOString();
  const decisionId = generateDecisionId(
    (rawEvent !== null && typeof rawEvent === "object" && typeof (rawEvent as { id?: unknown }).id === "string")
      ? (rawEvent as { id: string }).id
      : "unknown"
  );

  const meta: EvalMeta = { startTime, batchTimestamp, decisionId };

  // ── Step 1: validate event shape ──────────────────────────────────────
  let validatedEvent: DomainEvent;
  try {
    assertDomainEvent(rawEvent);
    validatedEvent = rawEvent;
  } catch (err) {
    return buildValidationErrorOutput(rawEvent, meta, err);
  }

  // ── Step 2: security guard ────────────────────────────────────────────
  const guardResult = runSecurityGuard(validatedEvent, config);
  if (guardResult.passed === false) {
    return buildSecurityRejectionOutput(validatedEvent, meta, guardResult.reason, guardResult.code);
  }

  const event = guardResult.sanitizedEvent;

  // ── Step 3: collect enabled rules ─────────────────────────────────────
  const rules = getEnabledRules(config.enabledRuleIds);

  if (rules.length > config.limits.maxRulesPerEvaluation) {
    return buildLimitExceededOutput(
      event, meta,
      `Rule count ${rules.length} exceeds maxRulesPerEvaluation limit of ${config.limits.maxRulesPerEvaluation}`
    );
  }

  // ── Step 4: build emission buffers ────────────────────────────────────
  const revenueBuffer: RevenueEvent[] = [];
  const riskBuffer: RiskEvent[] = [];
  const traceBuffer: RuleTrace[] = [];
  const verdictContributions: VerdictContribution[] = [];
  let evaluationSequence = 0;

  const emitRevenue: EmitRevenueFn = (partial) => {
    const id = generateRevenueEventId(partial.triggeringEventId, partial.triggeringRuleId ?? "engine");
    const record: RevenueEvent = {
      id,
      recordedAt: batchTimestamp,
      ...partial,
    };
    revenueBuffer.push(record);
  };

  const emitRisk: EmitRiskFn = (partial) => {
    const id = generateRiskEventId(partial.triggeringEventId, partial.triggeringRuleId ?? "engine");
    const record: RiskEvent = {
      id,
      detectedAt: batchTimestamp,
      status: "open",
      ...partial,
    };
    riskBuffer.push(record);
  };

  // ── Step 5: run rules ─────────────────────────────────────────────────
  for (const rule of rules) {
    const elapsedMs = performance.now() - startTime;
    const budgetRemaining = config.limits.maxTotalExecutionMs - elapsedMs;

    const ctx: EvaluationContext = {
      event,
      state,
      config,
      evaluationSequence: ++evaluationSequence,
      batchTimestamp,
      emitRevenue,
      emitRisk,
    };

    const harnessResult = invokeRule(rule, ctx, evaluationSequence - 1, budgetRemaining);

    switch (harnessResult.kind) {
      case "evaluated": {
        // Patch the measured execution time from the harness into the trace.
        // Rules set executionTimeMs: 0 as a placeholder; the harness is the
        // only place that can measure actual wall-clock time post-evaluation.
        const patchedTrace: RuleTrace = {
          ...harnessResult.result.trace,
          executionTimeMs: Math.round(harnessResult.executionMs * 100) / 100,
        };
        traceBuffer.push(patchedTrace);
        verdictContributions.push(harnessResult.result.verdictContribution);
        break;
      }
      case "skipped": {
        traceBuffer.push(harnessResult.trace);
        // skipped rules don't contribute a verdict
        break;
      }
      case "error": {
        traceBuffer.push(harnessResult.trace);
        // error rules contribute a "flag" to ensure visibility
        verdictContributions.push({ type: "flag", reason: `Rule ${rule.id} threw an error` });
        break;
      }
      case "budget_exceeded": {
        traceBuffer.push(harnessResult.trace);
        // stop processing remaining rules
        break;
      }
    }

    if (harnessResult.kind === "budget_exceeded") break;
  }

  // ── Step 6: merge verdicts ────────────────────────────────────────────
  const winningContribution = mergeVerdicts(verdictContributions);
  const totalExecutionMs = performance.now() - startTime;

  // ── Step 7: assemble output ───────────────────────────────────────────
  const { truncatedTraces, truncated } = applyTraceLimit(
    traceBuffer,
    config.security.maxTraceRecords
  );

  const decision = buildDecisionResult(
    event,
    meta,
    winningContribution,
    truncatedTraces,
    revenueBuffer,
    riskBuffer,
    totalExecutionMs
  );

  return {
    decision,
    revenueEvents: revenueBuffer,
    riskEvents: riskBuffer,
    ruleTraces: truncatedTraces,
    traceTruncated: truncated,
  };
}

// ---------------------------------------------------------------------------
// Output assemblers
// ---------------------------------------------------------------------------

function buildDecisionResult(
  event: Readonly<DomainEvent>,
  meta: EvalMeta,
  contribution: VerdictContribution,
  traces: ReadonlyArray<RuleTrace>,
  revenueEvents: ReadonlyArray<RevenueEvent>,
  riskEvents: ReadonlyArray<RiskEvent>,
  totalExecutionMs: number
): DecisionResult {
  const traceSummaries: RuleTraceSummary[] = traces.map((t) => ({
    traceId: t.traceId,
    ruleId: t.ruleId,
    ruleName: t.ruleName,
    triggeringEventType: t.triggeringEventType,
    evaluatedAt: t.evaluatedAt,
    executionTimeMs: t.executionTimeMs,
    outcome: t.outcome,
    explanation: t.explanation,
  }));

  const appliedActions: AppliedAction[] = traces.flatMap((t) =>
    t.actions
      .filter((a) => a.executed)
      .map((a) => ({
        actionId: `${t.traceId}_${a.actionType}`,
        actionType: a.actionType,
        description: a.description,
        appliedByRuleId: t.ruleId,
        appliedByRuleName: t.ruleName,
        appliedAt: meta.batchTimestamp,
        parameters: a.result ?? {},
        succeeded: a.executed && a.errorMessage === undefined,
        ...(a.errorMessage !== undefined ? { errorMessage: a.errorMessage } : {}),
      }))
  );

  const { verdict, reason } = contributionToVerdict(contribution, event.id);

  const base: DecisionResult = {
    decisionId: meta.decisionId,
    sourceEventId: event.id,
    sourceEventType: event.type,
    decidedAt: meta.batchTimestamp,
    totalExecutionTimeMs: Math.round(totalExecutionMs * 100) / 100,
    verdict,
    reason,
    confidence: computeConfidence(traces),
    appliedRuleTraces: traceSummaries,
    appliedActions,
  };

  if (
    contribution.type === "transform" &&
    contribution.payload !== undefined
  ) {
    return { ...base, transformedPayload: contribution.payload };
  }

  if (contribution.type === "defer" && contribution.until !== undefined) {
    return { ...base, deferUntil: contribution.until };
  }

  return base;
}

function contributionToVerdict(
  contribution: VerdictContribution,
  eventId: string
): { verdict: DecisionResult["verdict"]; reason: string } {
  switch (contribution.type) {
    case "block":
      return { verdict: "block", reason: contribution.reason };
    case "flag":
      return { verdict: "flag", reason: contribution.reason };
    case "transform":
      return { verdict: "transform", reason: "Payload transformed by rule" };
    case "defer":
      return { verdict: "defer", reason: `Event ${eventId} deferred` };
    case "allow":
    case "no_opinion":
      return { verdict: "allow", reason: "No rule blocked or flagged this event" };
  }
}

function computeConfidence(traces: ReadonlyArray<RuleTrace>): number {
  if (traces.length === 0) return 1.0;
  const errorCount = traces.filter((t) => t.outcome === "error").length;
  if (errorCount > 0) return Math.max(0.1, 1.0 - errorCount * 0.2);
  const firedCount = traces.filter((t) => t.outcome === "fired").length;
  return firedCount > 0 ? 1.0 : 0.9;
}

function applyTraceLimit(
  traces: RuleTrace[],
  limit: number
): { truncatedTraces: ReadonlyArray<RuleTrace>; truncated: boolean } {
  if (traces.length <= limit) {
    return { truncatedTraces: traces, truncated: false };
  }
  return { truncatedTraces: traces.slice(0, limit), truncated: true };
}

// ---------------------------------------------------------------------------
// Error output builders
// ---------------------------------------------------------------------------

function buildValidationErrorOutput(
  rawEvent: unknown,
  meta: EvalMeta,
  err: unknown
): EngineEvaluationOutput {
  const errorMsg = err instanceof Error ? err.message : String(err);
  const eventId =
    (rawEvent !== null && typeof rawEvent === "object" && typeof (rawEvent as { id?: unknown }).id === "string")
      ? (rawEvent as { id: string }).id
      : "unknown";

  const decision: DecisionResult = {
    decisionId: meta.decisionId,
    sourceEventId: eventId,
    sourceEventType: "rule.error",
    decidedAt: meta.batchTimestamp,
    totalExecutionTimeMs: 0,
    verdict: "error",
    reason: `Event failed validation: ${errorMsg}`,
    confidence: 0,
    appliedRuleTraces: [],
    appliedActions: [],
    engineError: {
      message: errorMsg,
      code: "INVALID_EVENT_SHAPE",
      recoverable: false,
    },
  };

  return { decision, revenueEvents: [], riskEvents: [], ruleTraces: [], traceTruncated: false };
}

function buildSecurityRejectionOutput(
  event: Readonly<DomainEvent>,
  meta: EvalMeta,
  reason: string,
  code: string
): EngineEvaluationOutput {
  const decision: DecisionResult = {
    decisionId: meta.decisionId,
    sourceEventId: event.id,
    sourceEventType: event.type,
    decidedAt: meta.batchTimestamp,
    totalExecutionTimeMs: 0,
    verdict: "block",
    reason: `Security guard rejected event: ${reason}`,
    confidence: 1.0,
    appliedRuleTraces: [],
    appliedActions: [],
    engineError: {
      message: reason,
      code,
      recoverable: false,
    },
  };

  return { decision, revenueEvents: [], riskEvents: [], ruleTraces: [], traceTruncated: false };
}

function buildLimitExceededOutput(
  event: Readonly<DomainEvent>,
  meta: EvalMeta,
  reason: string
): EngineEvaluationOutput {
  const decision: DecisionResult = {
    decisionId: meta.decisionId,
    sourceEventId: event.id,
    sourceEventType: event.type,
    decidedAt: meta.batchTimestamp,
    totalExecutionTimeMs: 0,
    verdict: "error",
    reason,
    confidence: 0,
    appliedRuleTraces: [],
    appliedActions: [],
    engineError: {
      message: reason,
      code: "RULE_LIMIT_EXCEEDED",
      recoverable: false,
    },
  };

  return { decision, revenueEvents: [], riskEvents: [], ruleTraces: [], traceTruncated: false };
}


