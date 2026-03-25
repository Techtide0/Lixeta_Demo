/**
 * @file config/engine-bootstrap.ts
 * @description Constructs the EngineConfig from GatewayEnv and registers
 * all built-in rules exactly once at server startup.
 *
 * This is the bridge between the HTTP layer and the rules engine.
 * No other file in the gateway should construct EngineConfig directly.
 *
 * Security notes
 * ──────────────
 * • `trustedSourceIds` comes from the environment — empty list means "allow
 *   all" in development and "block everything" in production (enforced by
 *   env validation).
 * • `capturePayloadSnapshot` is ALWAYS false in production to prevent PII
 *   leaking into rule traces returned by the API.
 * • `freezeRegistry()` is called here — no rule can be registered after
 *   this point, preventing runtime rule injection.
 */

import {
  buildEngineConfig,
  registerBuiltinRules,
  freezeRegistry,
  ALL_BUILTIN_RULE_IDS,
} from "@lixeta/rules-engine";

import type { EngineConfig } from "@lixeta/rules-engine";
import type { GatewayEnv } from "./env.js";

let _engineConfig: EngineConfig | null = null;

/**
 * Build and cache the EngineConfig.
 * Registers built-in rules and freezes the registry on first call.
 */
export function getEngineConfig(env: GatewayEnv): EngineConfig {
  if (_engineConfig !== null) return _engineConfig;

  // Register all built-in rules (idempotent within one process)
  registerBuiltinRules();

  // Seal the registry — no more rules can be added at runtime
  freezeRegistry();

  const enabledRuleIds =
    env.ENABLED_RULE_IDS.length > 0
      ? env.ENABLED_RULE_IDS
      : [...ALL_BUILTIN_RULE_IDS];

  _engineConfig = buildEngineConfig({
    engineId: "sandbox-gateway",
    engineVersion: "1.0.0",
    enabledRuleIds,
    revenue: {
      currency: env.REVENUE_CURRENCY,
      minorUnitMultiplier: 100,
    },
    limits: {
      maxRulesPerEvaluation: env.ENGINE_MAX_RULES,
      maxRuleExecutionMs: 50,
      maxTotalExecutionMs: env.ENGINE_MAX_TOTAL_MS,
      maxPayloadBytes: env.ENGINE_MAX_PAYLOAD_BYTES,
    },
    security: {
      // null = allow all sources (dev); non-empty = strict allowlist (prod)
      trustedSourceIds:
        env.TRUSTED_SOURCE_IDS.length > 0
          ? env.TRUSTED_SOURCE_IDS
          : null,
      allowedChannels: null,
      sanitizePayloads: true,
      // NEVER expose raw payloads in production rule traces
      capturePayloadSnapshot: env.NODE_ENV !== "production",
      maxTraceRecords: 100,
    },
    meta: {
      environment: env.NODE_ENV,
      gatewayVersion: "1.0.0",
    },
  });

  return _engineConfig;
}

/** FOR TESTING ONLY — resets cached engine config so tests can set fresh envs. */
export function _resetEngineConfigForTesting(): void {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("_resetEngineConfigForTesting() is not allowed in production.");
  }
  _engineConfig = null;
}
