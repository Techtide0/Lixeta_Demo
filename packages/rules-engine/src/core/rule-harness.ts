/**
 * @file rule-harness.ts
 * @description Wraps every rule invocation with:
 *
 *   1. Execution time measurement
 *   2. Timeout enforcement (synchronous budget check)
 *   3. Error isolation — a throwing rule never crashes the engine
 *   4. Automatic "skipped" trace generation when `applies()` returns false
 *   5. Rule-count budget enforcement
 *
 * Security notes
 * ──────────────
 * • Rule errors are caught and converted to "error" outcome traces. Stack
 *   traces are included only when `capturePayloadSnapshot` is enabled (i.e.,
 *   non-production) to avoid leaking internals through the API.
 * • The monotonic startTime comparison prevents a rule from reporting a
 *   negative or manipulated execution time.
 */

import type {
  RuleTrace,
  ConditionTrace,
  ActionTrace,
} from "@lixeta/models";

import type { Rule, RuleEvaluationResult } from "../core/rule.js";
import type { EvaluationContext } from "../core/evaluation-context.js";
import { generateTraceId } from "../utils/id-generator.js";

// ---------------------------------------------------------------------------
// Harness result
// ---------------------------------------------------------------------------

export type HarnessResult =
  | { readonly kind: "evaluated"; readonly result: RuleEvaluationResult; readonly executionMs: number }
  | { readonly kind: "skipped"; readonly trace: RuleTrace; readonly executionMs: number }
  | { readonly kind: "error"; readonly trace: RuleTrace; readonly executionMs: number }
  | { readonly kind: "budget_exceeded"; readonly trace: RuleTrace };

// ---------------------------------------------------------------------------
// Harness
// --------------------------------------------------------------------------->

/**
 * Invoke one rule safely within the evaluation budget.
 *
 * @param rule          The rule to invoke
 * @param ctx           The shared evaluation context
 * @param ruleIndex     Position of this rule in the evaluation sequence
 * @param budgetRemainingMs  How many ms remain in the total engine budget
 */
export function invokeRule(
  rule: Rule,
  ctx: EvaluationContext,
  ruleIndex: number,
  budgetRemainingMs: number
): HarnessResult {
  const traceId = generateTraceId(rule.id, ctx.event.id);

  // ── budget check ──
  if (budgetRemainingMs <= 0) {
    const trace = buildSkippedTrace(
      traceId,
      rule,
      ctx,
      `Engine budget exhausted before rule ${ruleIndex + 1} (${rule.id}) could run`,
      "disabled",
      0
    );
    return { kind: "budget_exceeded", trace };
  }

  // ── applies() check ──
  let appliesResult: boolean;
  const appliesStart = performance.now();

  try {
    appliesResult = rule.applies(ctx);
  } catch (err) {
    const executionMs = Math.max(0, performance.now() - appliesStart);
    const trace = buildErrorTrace(traceId, rule, ctx, err, executionMs);
    return { kind: "error", trace, executionMs };
  }

  if (!appliesResult) {
    const executionMs = Math.max(0, performance.now() - appliesStart);
    const trace = buildSkippedTrace(
      traceId,
      rule,
      ctx,
      `Rule pre-condition returned false — event type or state did not match`,
      "skipped",
      executionMs
    );
    return { kind: "skipped", trace, executionMs };
  }

  // ── evaluate() ──
  const evalStart = performance.now();

  try {
    const result = rule.evaluate(ctx);

    const executionMs = Math.max(0, performance.now() - evalStart);

    // Check per-rule timeout AFTER execution (synchronous — we can't interrupt mid-run)
    if (executionMs > ctx.config.limits.maxRuleExecutionMs) {
      // Emit the result but annotate the trace with a timeout warning
      const annotatedTrace: RuleTrace = {
        ...result.trace,
        explanation:
          `[TIMEOUT WARNING: ${executionMs.toFixed(1)}ms exceeded limit of ` +
          `${ctx.config.limits.maxRuleExecutionMs}ms] ${result.trace?.explanation ?? ""}`,
      };
      return {
        kind: "evaluated",
        result: { ...result, trace: annotatedTrace },
        executionMs,
      };
    }

    return { kind: "evaluated", result, executionMs };
  } catch (err) {
    const executionMs = Math.max(0, performance.now() - evalStart);
    const trace = buildErrorTrace(traceId, rule, ctx, err, executionMs);
    return { kind: "error", trace, executionMs };
  }
}

// ---------------------------------------------------------------------------
// Trace builders
// ---------------------------------------------------------------------------

function buildSkippedTrace(
  traceId: string,
  rule: Rule,
  ctx: EvaluationContext,
  explanation: string,
  outcome: "skipped" | "disabled",
  executionMs: number
): RuleTrace {
  const conditions: ConditionTrace[] = [];
  const actions: ActionTrace[] = [];

  return {
    traceId,
    ruleId: rule.id,
    ruleName: rule.name,
    ruleVersion: rule.version,
    triggeringEventId: ctx.event.id,
    triggeringEventType: ctx.event.type,
    evaluatedAt: ctx.batchTimestamp,
    executionTimeMs: executionMs,
    outcome,
    explanation,
    conditions,
    actions,
    contextSnapshot: buildContextSnapshot(ctx),
  };
}

function buildErrorTrace(
  traceId: string,
  rule: Rule,
  ctx: EvaluationContext,
  err: unknown,
  executionMs: number
): RuleTrace {
  const errorMessage =
    err instanceof Error ? err.message : `Unknown error: ${String(err)}`;

  // Only expose stack trace in non-production to avoid internal leakage
  const stackTrace =
    err instanceof Error &&
    ctx.config.security.capturePayloadSnapshot
      ? err.stack
      : undefined;

  const actions: ActionTrace[] = [];
  const conditions: ConditionTrace[] = [];

  const base: RuleTrace = {
    traceId,
    ruleId: rule.id,
    ruleName: rule.name,
    ruleVersion: rule.version,
    triggeringEventId: ctx.event.id,
    triggeringEventType: ctx.event.type,
    evaluatedAt: ctx.batchTimestamp,
    executionTimeMs: executionMs,
    outcome: "error",
    explanation: `Rule threw an exception: ${errorMessage}`,
    conditions,
    actions,
    contextSnapshot: buildContextSnapshot(ctx),
  };

  if (stackTrace !== undefined) {
    return { ...base, error: { message: errorMessage, code: "RULE_EXCEPTION", stackTrace } };
  }
  return { ...base, error: { message: errorMessage, code: "RULE_EXCEPTION" } };
}

function buildContextSnapshot(
  ctx: EvaluationContext
): Readonly<Record<string, unknown>> {
  if (!ctx.config.security.capturePayloadSnapshot) {
    // Return minimal non-sensitive context
    return {
      eventId: ctx.event.id,
      eventType: ctx.event.type,
      sourceId: ctx.event.source.id,
      sequence: ctx.evaluationSequence,
    };
  }

  // Full snapshot for development/debug environments
  return {
    eventId: ctx.event.id,
    eventType: ctx.event.type,
    sourceId: ctx.event.source.id,
    eventTimestamp: ctx.event.timestamp,
    payload: ctx.event.payload,
    sequence: ctx.evaluationSequence,
    simulationStatus: ctx.state.status,
  };
}


