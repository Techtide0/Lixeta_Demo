/**
 * @file pacs004.ts
 * @description ISO 20022 pacs.004.001.09 — Payment Return
 *
 * Produces a valid, deterministic ISO 20022 payment return message.
 * Used when a credit transfer (pacs.008) is rejected, reversed, or
 * cannot be completed — e.g. invalid account, insufficient funds,
 * regulatory block, or fraud prevention.
 *
 * Security guarantees: same as pacs.008 — all inputs escaped/validated.
 */
import type { Pacs004Input, Pacs004Output } from "./types.js";
/**
 * Build a pacs.004.001.09 Payment Return XML document.
 *
 * @param input  Payment return parameters including return code and original msgId
 * @returns      Structured output with return XML + metadata
 * @throws       If input validation fails
 */
export declare function buildPacs004(input: Pacs004Input): Pacs004Output;
