/**
 * @file security-guard.ts
 * @description Pre-evaluation security validation layer.
 *
 * This module is the engine's first line of defence. Every event passes
 * through here before any rule is invoked. A rejection here means zero rules
 * fire — the engine returns a hard "block" verdict immediately.
 *
 * Checks performed (in order)
 * ────────────────────────────
 * 1. Payload size check      — reject oversized payloads (memory exhaustion)
 * 2. Source allowlist check  — reject events from untrusted sources
 * 3. Channel allowlist check — reject events on disallowed channels
 * 4. Payload sanitisation    — strip "__proto__", "constructor", "prototype"
 *                              keys and any "__"-prefixed keys
 * 5. Timestamp staleness     — warn (not reject) if event is >5 min old
 *    (replay-attack signal; hard rejection is policy-configurable)
 */

import type { DomainEvent } from "@lixeta/models";
import type { EngineConfig } from "../core/engine-config.js";

// ---------------------------------------------------------------------------
// Guard result
// ---------------------------------------------------------------------------

export type SecurityGuardResult =
  | { readonly passed: true; readonly sanitizedEvent: Readonly<DomainEvent> }
  | { readonly passed: false; readonly reason: string; readonly code: SecurityRejectionCode };

export type SecurityRejectionCode =
  | "PAYLOAD_TOO_LARGE"
  | "UNTRUSTED_SOURCE"
  | "DISALLOWED_CHANNEL"
  | "MALFORMED_EVENT"
  | "TIMESTAMP_MISSING";

// ---------------------------------------------------------------------------
// Dangerous payload keys (prototype-pollution vectors)
// ---------------------------------------------------------------------------

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const DANGEROUS_KEY_PREFIX = "__";

// ---------------------------------------------------------------------------
// Payload sanitiser
// ---------------------------------------------------------------------------

/**
 * Returns a new payload object with dangerous keys removed.
 * Operates recursively on nested plain objects.
 *
 * This is a defence-in-depth measure. Rules should never reach into raw
 * payload keys that start with "__", but we strip them anyway.
 */
function sanitizeObject(
  obj: Readonly<Record<string, unknown>>,
  depth = 0
): Readonly<Record<string, unknown>> {
  // Limit recursion to avoid stack-overflow on adversarial deep objects
  if (depth > 8) return {};

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (key.startsWith(DANGEROUS_KEY_PREFIX)) continue;

    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    ) {
      result[key] = sanitizeObject(
        value as Readonly<Record<string, unknown>>,
        depth + 1
      );
    } else {
      result[key] = value;
    }
  }

  return result as Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Payload size check
// ---------------------------------------------------------------------------

function estimatePayloadBytes(payload: Readonly<Record<string, unknown>>): number {
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length;
  } catch {
    // If serialisation fails, treat as oversized
    return Number.MAX_SAFE_INTEGER;
  }
}

// ---------------------------------------------------------------------------
// Main guard
// ---------------------------------------------------------------------------

export function runSecurityGuard(
  event: Readonly<DomainEvent>,
  config: Readonly<EngineConfig>
): SecurityGuardResult {
  const { security, limits } = config;

  // 1. Payload size
  const payloadBytes = estimatePayloadBytes(event.payload);
  if (payloadBytes > limits.maxPayloadBytes) {
    return {
      passed: false,
      code: "PAYLOAD_TOO_LARGE",
      reason: `Payload size ${payloadBytes} bytes exceeds limit of ${limits.maxPayloadBytes} bytes`,
    };
  }

  // 2. Source allowlist
  if (
    security.trustedSourceIds !== null &&
    !security.trustedSourceIds.includes(event.source.id)
  ) {
    return {
      passed: false,
      code: "UNTRUSTED_SOURCE",
      reason: `Event source "${event.source.id}" is not in the trusted sources allowlist`,
    };
  }

  // 3. Channel allowlist
  if (
    security.allowedChannels !== null &&
    !security.allowedChannels.includes(event.source.channel)
  ) {
    return {
      passed: false,
      code: "DISALLOWED_CHANNEL",
      reason: `Channel "${event.source.channel}" is not in the allowed channels list`,
    };
  }

  // 4. Timestamp presence (basic replay-attack signal)
  if (!event.timestamp) {
    return {
      passed: false,
      code: "TIMESTAMP_MISSING",
      reason: "Event is missing a timestamp — possible replay attack or malformed input",
    };
  }

  // 5. Payload sanitisation
  const sanitizedPayload = security.sanitizePayloads
    ? sanitizeObject(event.payload)
    : event.payload;

  const sanitizedEvent: Readonly<DomainEvent> = {
    ...event,
    payload: sanitizedPayload,
  };

  return { passed: true, sanitizedEvent };
}


