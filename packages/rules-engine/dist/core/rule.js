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
// ---------------------------------------------------------------------------
// Outcome helpers
// ---------------------------------------------------------------------------
export function allowContribution() {
    return { type: "allow" };
}
export function blockContribution(reason) {
    return { type: "block", reason };
}
export function flagContribution(reason) {
    return { type: "flag", reason };
}
export function noOpinion() {
    return { type: "no_opinion" };
}
// ---------------------------------------------------------------------------
// Verdict priority merge
// ---------------------------------------------------------------------------
const VERDICT_PRIORITY = [
    "block",
    "flag",
    "transform",
    "defer",
    "allow",
    "no_opinion",
];
/**
 * Merge multiple verdict contributions into a single winning verdict.
 * Higher-priority verdicts override lower ones.
 */
export function mergeVerdicts(contributions) {
    if (contributions.length === 0)
        return { type: "allow" };
    let winner = { type: "no_opinion" };
    let winnerPriority = VERDICT_PRIORITY.indexOf("no_opinion");
    for (const contrib of contributions) {
        const priority = VERDICT_PRIORITY.indexOf(contrib.type);
        if (priority === -1)
            continue; // unknown type — skip rather than silently win
        if (priority < winnerPriority) {
            winner = contrib;
            winnerPriority = priority;
        }
    }
    return winner;
}
// ---------------------------------------------------------------------------
// Trace outcome helper
// ---------------------------------------------------------------------------
export function outcomeFromContribution(contrib) {
    switch (contrib.type) {
        case "allow":
            return "fired";
        case "block":
            return "fired";
        case "flag":
            return "fired";
        case "transform":
            return "fired";
        case "defer":
            return "fired";
        case "no_opinion":
            return "no_match";
    }
}
