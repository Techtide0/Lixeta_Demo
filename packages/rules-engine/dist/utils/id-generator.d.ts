/**
 * @file id-generator.ts
 * @description Deterministic, collision-resistant ID generation for engine outputs.
 *
 * Security notes
 * ──────────────
 * • IDs are NOT cryptographically random — they are deterministic hashes.
 *   This is intentional: given the same inputs, the same ID is produced,
 *   making outputs idempotent and replay-safe.
 * • We use a simple FNV-1a 64-bit hash approximated in JS (53-bit safe int)
 *   combined with a monotonic counter to guarantee uniqueness within one
 *   process lifetime.
 * • Never use these IDs as secrets or tokens. They are audit identifiers only.
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
