/**
 * @file engine-config.ts
 * @description Immutable configuration that governs one engine evaluation run.
 *
 * Security notes
 * ──────────────
 * • maxRules / maxExecutionMs exist to prevent runaway rule loops (DoS guard).
 * • trustedSources is an allowlist — events from unlisted sources are rejected
 *   before any rule fires, preventing injection via untrusted plugins.
 * • sanitizePayloads strips keys that start with "__" to block prototype-
 *   pollution vectors from arriving in event payloads.
 */
// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
export const DEFAULT_EXECUTION_LIMITS = {
    maxRulesPerEvaluation: 50,
    maxRuleExecutionMs: 50,
    maxTotalExecutionMs: 200,
    maxPayloadBytes: 32_768,
};
export const DEFAULT_SECURITY_POLICY = {
    trustedSourceIds: null, // permissive in dev; must be set in prod
    allowedChannels: null,
    sanitizePayloads: true,
    capturePayloadSnapshot: false,
    maxTraceRecords: 100,
};
export const PRODUCTION_SECURITY_POLICY = {
    trustedSourceIds: [], // caller MUST populate this — empty = block everything
    allowedChannels: ["sms", "whatsapp", "email", "push", "in_app", "api"],
    sanitizePayloads: true,
    capturePayloadSnapshot: false,
    maxTraceRecords: 100,
};
/** Build a complete config with defaults filled in. */
export function buildEngineConfig(overrides) {
    return {
        revenue: { currency: "NGN", minorUnitMultiplier: 100 },
        limits: DEFAULT_EXECUTION_LIMITS,
        security: DEFAULT_SECURITY_POLICY,
        meta: {},
        aggressionLevel: 50,
        ...overrides,
    };
}
