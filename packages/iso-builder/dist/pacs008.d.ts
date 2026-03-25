/**
 * @file pacs008.ts
 * @description ISO 20022 pacs.008.001.08 — FI-to-FI Customer Credit Transfer
 *
 * Produces valid, deterministic ISO 20022 XML for a customer credit transfer.
 *
 * Security guarantees
 * ──────────────────
 * • All string fields are XML-escaped before insertion — prevents injection.
 * • ID fields are sanitized to [A-Za-z0-9\-_]{1,35}.
 * • Currency codes are validated against ISO 4217 format.
 * • Amounts must be positive integers (minor units) before formatting.
 * • Same input ALWAYS produces the same output (deterministic).
 *
 * Determinism
 * ───────────
 * If `msgId` and `endToEndId` are omitted, they are derived from an FNV-1a
 * hash of the canonical input — so identical inputs produce identical IDs.
 * This enables idempotent replay and audit trail validation.
 */
import type { PaymentInput, Pacs008Output } from "./types.js";
/**
 * Build a pacs.008.001.08 Customer Credit Transfer XML document.
 *
 * @param input  Validated payment parameters
 * @returns      Structured output with XML + metadata
 * @throws       If input validation fails (bad currency, zero amount, etc.)
 */
export declare function buildPacs008(input: PaymentInput): Pacs008Output;
