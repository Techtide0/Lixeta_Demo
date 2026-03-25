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

import type { EventChannel } from "@lixeta/models";

// ---------------------------------------------------------------------------
// Revenue config
// ---------------------------------------------------------------------------

export interface RevenueCurrencyConfig {
  /** ISO 4217 code, e.g. "NGN" */
  readonly currency: string;
  /** Minor unit multiplier (100 for NGN kobo, 100 for USD cents) */
  readonly minorUnitMultiplier: number;
}

// ---------------------------------------------------------------------------
// Rule execution limits (DoS / runaway protection)
// ---------------------------------------------------------------------------

export interface EngineExecutionLimits {
  /**
   * Hard ceiling on total rules evaluated per call.
   * Engine aborts with a safe "error" verdict if exceeded.
   * Default: 50
   */
  readonly maxRulesPerEvaluation: number;

  /**
   * Maximum wall-clock milliseconds a single rule may consume before it is
   * killed and an error trace is emitted.
   * Default: 50
   */
  readonly maxRuleExecutionMs: number;

  /**
   * Maximum total wall-clock milliseconds the entire evaluateEvent call may
   * take. Produces a partial result + error verdict if exceeded.
   * Default: 200
   */
  readonly maxTotalExecutionMs: number;

  /**
   * Maximum byte-length of a serialised event payload accepted by the engine.
   * Prevents memory exhaustion from crafted large events.
   * Default: 32 768 (32 KB)
   */
  readonly maxPayloadBytes: number;
}

// ---------------------------------------------------------------------------
// Security policy
// ---------------------------------------------------------------------------

export interface EngineSecurityPolicy {
  /**
   * Allowlist of event source IDs that the engine will process.
   * Events from any other source are rejected immediately with a "block"
   * verdict and a security audit trace — no rules fire.
   *
   * Set to null to disable the check (development only).
   */
  readonly trustedSourceIds: ReadonlyArray<string> | null;

  /**
   * Allowlist of channels that may submit events.
   * Null disables the check.
   */
  readonly allowedChannels: ReadonlyArray<EventChannel> | null;

  /**
   * When true, payload keys prefixed with "__" are stripped before rule
   * evaluation to prevent prototype-pollution attacks.
   * Default: true
   */
  readonly sanitizePayloads: boolean;

  /**
   * When true, the engine records a full sanitised snapshot of the event
   * payload inside each RuleTrace. Disable in environments where payloads
   * may contain PII or secrets.
   * Default: false
   */
  readonly capturePayloadSnapshot: boolean;

  /**
   * Maximum number of rule traces emitted per evaluation.
   * Excess traces are dropped (a truncation flag is set on the result).
   * Default: 100
   */
  readonly maxTraceRecords: number;
}

// ---------------------------------------------------------------------------
// EngineConfig
// ---------------------------------------------------------------------------

export interface EngineConfig {
  readonly engineId: string;
  readonly engineVersion: string;
  /** IDs of rules (from the registry) that are active for this config */
  readonly enabledRuleIds: ReadonlyArray<string>;
  readonly revenue: RevenueCurrencyConfig;
  readonly limits: EngineExecutionLimits;
  readonly security: EngineSecurityPolicy;
  /**
   * Arbitrary metadata — passed through to DecisionResult for observability.
   * Never used by the engine itself (no dynamic dispatch on this field).
   */
  readonly meta: Readonly<Record<string, string>>;
  /**
   * Engine aggression level (0–100). Rules use this to tune sensitivity.
   * 0 = most conservative, 100 = most aggressive.
   * Default: 50 (balanced).
   */
  readonly aggressionLevel: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_EXECUTION_LIMITS: EngineExecutionLimits = {
  maxRulesPerEvaluation: 50,
  maxRuleExecutionMs: 50,
  maxTotalExecutionMs: 200,
  maxPayloadBytes: 32_768,
} as const;

export const DEFAULT_SECURITY_POLICY: EngineSecurityPolicy = {
  trustedSourceIds: null, // permissive in dev; must be set in prod
  allowedChannels: null,
  sanitizePayloads: true,
  capturePayloadSnapshot: false,
  maxTraceRecords: 100,
} as const;

export const PRODUCTION_SECURITY_POLICY: EngineSecurityPolicy = {
  trustedSourceIds: [], // caller MUST populate this — empty = block everything
  allowedChannels: ["sms", "whatsapp", "email", "push", "in_app", "api"],
  sanitizePayloads: true,
  capturePayloadSnapshot: false,
  maxTraceRecords: 100,
} as const;

/** Build a complete config with defaults filled in. */
export function buildEngineConfig(
  overrides: Pick<EngineConfig, "engineId" | "engineVersion" | "enabledRuleIds"> &
    Partial<Omit<EngineConfig, "engineId" | "engineVersion" | "enabledRuleIds">>
): EngineConfig {
  return {
    revenue: { currency: "NGN", minorUnitMultiplier: 100 },
    limits: DEFAULT_EXECUTION_LIMITS,
    security: DEFAULT_SECURITY_POLICY,
    meta: {},
    aggressionLevel: 50,
    ...overrides,
  };
}


