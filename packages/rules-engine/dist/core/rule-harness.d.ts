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
import type { RuleTrace } from "@lixeta/models";
import type { Rule, RuleEvaluationResult } from "../core/rule.js";
import type { EvaluationContext } from "../core/evaluation-context.js";
export type HarnessResult = {
    readonly kind: "evaluated";
    readonly result: RuleEvaluationResult;
    readonly executionMs: number;
} | {
    readonly kind: "skipped";
    readonly trace: RuleTrace;
    readonly executionMs: number;
} | {
    readonly kind: "error";
    readonly trace: RuleTrace;
    readonly executionMs: number;
} | {
    readonly kind: "budget_exceeded";
    readonly trace: RuleTrace;
};
/**
 * Invoke one rule safely within the evaluation budget.
 *
 * @param rule          The rule to invoke
 * @param ctx           The shared evaluation context
 * @param ruleIndex     Position of this rule in the evaluation sequence
 * @param budgetRemainingMs  How many ms remain in the total engine budget
 */
export declare function invokeRule(rule: Rule, ctx: EvaluationContext, ruleIndex: number, budgetRemainingMs: number): HarnessResult;
