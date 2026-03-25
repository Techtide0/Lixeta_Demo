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

// ---------------------------------------------------------------------------
// Monotonic counter (per-process, resets on restart — that's fine)
// ---------------------------------------------------------------------------

let _counter = 0;

function nextCounter(): string {
  _counter = (_counter + 1) % 999_999_999;
  return _counter.toString(36).padStart(6, "0");
}

// ---------------------------------------------------------------------------
// FNV-1a-ish hash (fast, non-crypto, deterministic)
// ---------------------------------------------------------------------------

function fnv1aHash(input: string): string {
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
export function generateTraceId(ruleId: string, eventId: string): string {
  return `trc_${fnv1aHash(ruleId)}_${fnv1aHash(eventId)}_${nextCounter()}`;
}

/**
 * Generate a revenue event ID.
 * Format: `rev_{eventId_hash}_{ruleId_hash}_{counter}`
 */
export function generateRevenueEventId(
  triggeringEventId: string,
  ruleId: string
): string {
  return `rev_${fnv1aHash(triggeringEventId)}_${fnv1aHash(ruleId)}_${nextCounter()}`;
}

/**
 * Generate a risk event ID.
 * Format: `risk_{eventId_hash}_{ruleId_hash}_{counter}`
 */
export function generateRiskEventId(
  triggeringEventId: string,
  ruleId: string
): string {
  return `risk_${fnv1aHash(triggeringEventId)}_${fnv1aHash(ruleId)}_${nextCounter()}`;
}

/**
 * Generate a decision ID for a full evaluation result.
 * Format: `dec_{eventId_hash}_{counter}`
 */
export function generateDecisionId(sourceEventId: string): string {
  return `dec_${fnv1aHash(sourceEventId)}_${nextCounter()}`;
}

/**
 * Reset the counter — FOR TESTING ONLY.
 */
export function _resetCounterForTesting(): void {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("_resetCounterForTesting() is not allowed in production.");
  }
  _counter = 0;
}


