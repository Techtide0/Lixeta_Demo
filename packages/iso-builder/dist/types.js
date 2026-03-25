/**
 * @file types.ts
 * @description Shared input/output types for the ISO builder package.
 *
 * These types are the boundary contract between callers and the builders.
 * Callers supply raw financial data; builders return structured ISO XML.
 */
export const RETURN_REASON_LABELS = {
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
