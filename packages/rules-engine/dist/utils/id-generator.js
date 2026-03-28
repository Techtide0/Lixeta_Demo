/**
 * @file id-generator.ts
 * @description Deterministic, collision-resistant ID generation for engine outputs.
 *
 * Security notes
 * ──────────────
 * • IDs combine a fast FNV-1a hash of the inputs with a monotonic counter.
 *   The hash component is deterministic; the counter component is NOT —
 *   calling the same generator twice produces different IDs. This guarantees
 *   uniqueness within a process lifetime but not strict idempotency across
 *   calls. Do not assume the same inputs yield the same ID.
 * • The counter resets on process restart. Treat IDs as opaque audit
 *   identifiers, never as secrets or replay tokens.
 */
// ---------------------------------------------------------------------------
// Monotonic counter (per-process, resets on restart — that's fine)
// ---------------------------------------------------------------------------
let _counter = 0;
function nextCounter() {
    _counter = (_counter + 1) % 999_999_999;
    return _counter.toString(36).padStart(6, "0");
}
// ---------------------------------------------------------------------------
// FNV-1a-ish hash (fast, non-crypto, deterministic)
// ---------------------------------------------------------------------------
function fnv1aHash(input) {
    let hash = 2_166_136_261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16_777_619) >>> 0;
    }
    return hash.toString(36);
}
// ---------------------------------------------------------------------------
// Public generators
// ---------------------------------------------------------------------------
/**
 * Generate a trace ID for a rule evaluation.
 * Format: `trc_{ruleId_hash}_{eventId_hash}_{counter}`
 */
export function generateTraceId(ruleId, eventId) {
    return `trc_${fnv1aHash(ruleId)}_${fnv1aHash(eventId)}_${nextCounter()}`;
}
/**
 * Generate a revenue event ID.
 * Format: `rev_{eventId_hash}_{ruleId_hash}_{counter}`
 */
export function generateRevenueEventId(triggeringEventId, ruleId) {
    return `rev_${fnv1aHash(triggeringEventId)}_${fnv1aHash(ruleId)}_${nextCounter()}`;
}
/**
 * Generate a risk event ID.
 * Format: `risk_{eventId_hash}_{ruleId_hash}_{counter}`
 */
export function generateRiskEventId(triggeringEventId, ruleId) {
    return `risk_${fnv1aHash(triggeringEventId)}_${fnv1aHash(ruleId)}_${nextCounter()}`;
}
/**
 * Generate a decision ID for a full evaluation result.
 * Format: `dec_{eventId_hash}_{counter}`
 */
export function generateDecisionId(sourceEventId) {
    return `dec_${fnv1aHash(sourceEventId)}_${nextCounter()}`;
}
/**
 * Reset the counter — FOR TESTING ONLY.
 */
export function _resetCounterForTesting() {
    if (process.env["NODE_ENV"] === "production") {
        throw new Error("_resetCounterForTesting() is not allowed in production.");
    }
    _counter = 0;
}
