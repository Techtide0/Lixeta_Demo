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
 *                              keys and any "__"-prefixed keys; sanitises
 *                              nested plain objects AND items inside arrays
 * 5. Timestamp presence      — reject if timestamp is missing or empty
 */
import type { DomainEvent } from "@lixeta/models";
import type { EngineConfig } from "../core/engine-config.js";
export type SecurityGuardResult = {
    readonly passed: true;
    readonly sanitizedEvent: Readonly<DomainEvent>;
} | {
    readonly passed: false;
    readonly reason: string;
    readonly code: SecurityRejectionCode;
};
export type SecurityRejectionCode = "PAYLOAD_TOO_LARGE" | "UNTRUSTED_SOURCE" | "DISALLOWED_CHANNEL" | "MALFORMED_EVENT" | "TIMESTAMP_MISSING";
export declare function runSecurityGuard(event: Readonly<DomainEvent>, config: Readonly<EngineConfig>): SecurityGuardResult;
