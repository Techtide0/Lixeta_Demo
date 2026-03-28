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
/**
 * Generate a trace ID for a rule evaluation.
 * Format: `trc_{ruleId_hash}_{eventId_hash}_{counter}`
 */
export declare function generateTraceId(ruleId: string, eventId: string): string;
/**
 * Generate a revenue event ID.
 * Format: `rev_{eventId_hash}_{ruleId_hash}_{counter}`
 */
export declare function generateRevenueEventId(triggeringEventId: string, ruleId: string): string;
/**
 * Generate a risk event ID.
 * Format: `risk_{eventId_hash}_{ruleId_hash}_{counter}`
 */
export declare function generateRiskEventId(triggeringEventId: string, ruleId: string): string;
/**
 * Generate a decision ID for a full evaluation result.
 * Format: `dec_{eventId_hash}_{counter}`
 */
export declare function generateDecisionId(sourceEventId: string): string;
/**
 * Reset the counter — FOR TESTING ONLY.
 */
export declare function _resetCounterForTesting(): void;
