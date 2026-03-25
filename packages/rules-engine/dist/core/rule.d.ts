/**
 * @file rule.ts
 * @description The Rule interface — the contract every rule in the engine
 * must satisfy.
 *
 * Design principles
 * ─────────────────
 * • A Rule is a pure-ish function. It reads context, emits outputs via
 *   callbacks, and returns a RuleTrace. It never mutates global state.
 * • `applies()` is a fast pre-check. The engine skips `evaluate()` entirely
 *   if `applies()` returns false — cheap guard before any real logic.
 * • Execution is synchronous. Async rules require a wrapper that resolves
 *   before the timeout budget expires (enforced by the engine harness).
 * • `version` is mandatory. Traces record which version of a rule fired,
 *   enabling deterministic replay and audit.
 *
 * Security notes
 * ──────────────
 * • Rules must not access `process`, `globalThis`, `eval`, `Function()`,
 *   or any I/O. This is enforced by code review + linting (no-restricted-
 *   globals / no-eval). Future: rules run in a VM sandbox.
 * • `id` must be unique across the registry. The registry enforces this at
 *   startup — duplicate IDs cause a hard boot error.
 */
import type { RuleTrace, RuleOutcome } from "@lixeta/models";
import type { EvaluationContext } from "./evaluation-context.js";
/**
 * What a rule returns after evaluation.
 *
 * The engine merges these into the final DecisionResult.
 */
export interface RuleEvaluationResult {
    readonly trace: RuleTrace;
    /**
     * Suggested contribution to the overall verdict.
     * The engine uses a priority merge: "block" > "flag" > "transform" >
     * "defer" > "allow". The highest-priority verdict wins.
     */
    readonly verdictContribution: VerdictContribution;
}
export type VerdictContribution = {
    readonly type: "allow";
} | {
    readonly type: "block";
    readonly reason: string;
} | {
    readonly type: "flag";
    readonly reason: string;
} | {
    readonly type: "transform";
    readonly payload: Readonly<Record<string, unknown>>;
} | {
    readonly type: "defer";
    readonly until: string;
} | {
    readonly type: "no_opinion";
};
export interface Rule {
    /** Unique stable identifier — never reuse a retired ID */
    readonly id: string;
    /** Human-readable display name */
    readonly name: string;
    /** SemVer — recorded in every trace this rule produces */
    readonly version: string;
    /**
     * Brief description of what this rule does.
     * Rendered in the audit dashboard — write for a non-engineer audience.
     */
    readonly description: string;
    /**
     * Pre-check: return true if this rule is applicable to the event.
     * Called before `evaluate()`. If false, evaluation is skipped entirely
     * and a "skipped" trace is emitted automatically by the engine harness.
     *
     * Keep this cheap — no heavy computation.
     */
    applies(ctx: EvaluationContext): boolean;
    /**
     * Core evaluation logic.
     * Only called when `applies()` returns true.
     *
     * Rules emit revenue/risk via ctx callbacks and return a trace + verdict.
     * They must NOT throw — wrap internal errors and return outcome: "error".
     */
    evaluate(ctx: EvaluationContext): RuleEvaluationResult;
}
export declare function allowContribution(): VerdictContribution;
export declare function blockContribution(reason: string): VerdictContribution;
export declare function flagContribution(reason: string): VerdictContribution;
export declare function noOpinion(): VerdictContribution;
/**
 * Merge multiple verdict contributions into a single winning verdict.
 * Higher-priority verdicts override lower ones.
 */
export declare function mergeVerdicts(contributions: ReadonlyArray<VerdictContribution>): VerdictContribution;
export declare function outcomeFromContribution(contrib: VerdictContribution): RuleOutcome;
