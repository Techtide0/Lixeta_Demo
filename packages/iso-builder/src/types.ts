/**
 * @file types.ts
 * @description Shared input/output types for the ISO builder package.
 *
 * These types are the boundary contract between callers and the builders.
 * Callers supply raw financial data; builders return structured ISO XML.
 */

// ---------------------------------------------------------------------------
// Shared input
// ---------------------------------------------------------------------------

/**
 * Core payment data required to build any ISO 20022 payment message.
 * All monetary amounts are in minor currency units (e.g. kobo for NGN).
 */
export interface PaymentInput {
  /** Amount in minor units (e.g. 150000 kobo = ₦1,500.00) */
  readonly amountMinorUnits: number;
  /** ISO 4217 currency code, e.g. "NGN" */
  readonly currency: string;
  /** Sender/debtor full name */
  readonly sender: string;
  /** Receiver/creditor full name */
  readonly receiver: string;
  /** Sender account number */
  readonly senderAccount: string;
  /** Receiver account number */
  readonly receiverAccount: string;
  /** Bank routing code (sort code / CBN clearing code) */
  readonly bankCode: string;
  /** Optional: override message ID (for deterministic replay) */
  readonly msgId?: string;
  /** Optional: override End-to-End ID */
  readonly endToEndId?: string;
}

// ---------------------------------------------------------------------------
// pacs.008 types
// ---------------------------------------------------------------------------

/** Output of the pacs.008 (Customer Credit Transfer) builder */
export interface Pacs008Output {
  /** ISO 20022 message type */
  readonly isoType: "pacs.008.001.08";
  /** Unique message identifier */
  readonly msgId: string;
  /** End-to-end transaction reference */
  readonly endToEndId: string;
  /** The full ISO 20022 XML document */
  readonly xml: string;
  /** ISO 8601 generation timestamp */
  readonly generatedAt: string;
  /** FNV-1a hash of the canonical input — proves determinism */
  readonly inputHash: string;
  /** Amount as formatted decimal string, e.g. "1500.00" */
  readonly formattedAmount: string;
  /** Currency code */
  readonly currency: string;
}

// ---------------------------------------------------------------------------
// pacs.004 types
// ---------------------------------------------------------------------------

/**
 * ISO 20022 return reason codes (pacs.004).
 * Subset of the most common real-world codes.
 */
export type ReturnCode =
  | "AC03"  // InvalidCreditorAccountNumber
  | "AC04"  // ClosedAccountNumber
  | "AC06"  // BlockedAccount
  | "AG01"  // TransactionForbidden
  | "AM04"  // InsufficientFunds
  | "AM09"  // WrongAmount
  | "FF01"  // InvalidFileFormat
  | "NARR"  // Narrative (custom reason)
  | "RR04"; // RegulatoryReason

export const RETURN_REASON_LABELS: Readonly<Record<ReturnCode, string>> = {
  AC03: "InvalidCreditorAccountNumber",
  AC04: "ClosedAccountNumber",
  AC06: "BlockedAccount",
  AG01: "TransactionForbidden",
  AM04: "InsufficientFunds",
  AM09: "WrongAmount",
  FF01: "InvalidFileFormat",
  NARR: "Narrative",
  RR04: "RegulatoryReason",
};

/** Additional fields required for a payment return */
export interface Pacs004Input extends PaymentInput {
  /** ISO return reason code */
  readonly returnCode: ReturnCode;
  /** Human-readable return reason */
  readonly returnReason: string;
  /** Message ID of the original pacs.008 being returned */
  readonly originalMsgId: string;
}

/** Output of the pacs.004 (Payment Return) builder */
export interface Pacs004Output {
  readonly isoType: "pacs.004.001.09";
  readonly msgId: string;
  readonly endToEndId: string;
  readonly xml: string;
  readonly generatedAt: string;
  readonly inputHash: string;
  readonly formattedAmount: string;
  readonly currency: string;
  readonly returnCode: ReturnCode;
  readonly returnReason: string;
  readonly originalMsgId: string;
}
