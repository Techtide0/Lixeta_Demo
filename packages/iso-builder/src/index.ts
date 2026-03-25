/**
 * @lixeta/iso-builder — public API
 *
 * ISO 20022 message builders for the Lixeta sandbox gateway.
 * Produces deterministic, XML-injection-safe pacs.008 and pacs.004 messages.
 */

export { buildPacs008 } from "./pacs008.js";
export { buildPacs004 } from "./pacs004.js";
export type {
  PaymentInput,
  Pacs008Output,
  Pacs004Input,
  Pacs004Output,
  ReturnCode,
} from "./types.js";
export { RETURN_REASON_LABELS } from "./types.js";
export { escapeXml, sanitizeId } from "./xml-escape.js";
