/**
 * @file transaction.ts
 * @description Represents a single financial or messaging transaction tracked
 * within the simulation. Transactions are the primary objects that rules
 * evaluate against.
 */
import type { EventChannel } from "../events/index.js";
export type TransactionStatus = "pending" | "processing" | "succeeded" | "failed" | "reversed" | "expired" | "flagged";
export type TransactionType = "sms_outbound" | "sms_inbound" | "payment_outbound" | "payment_inbound" | "payment_reversal" | "notification";
export interface TransactionParty {
    readonly id: string;
    readonly type: "user" | "system" | "external" | "plugin";
    readonly displayName: string;
    readonly timezone?: string;
    readonly country?: string;
}
export interface Money {
    /** Amount in the smallest currency unit (e.g. kobo, cents) */
    readonly amountMinorUnits: number;
    /** ISO 4217 currency code */
    readonly currency: string;
}
/**
 * A discrete transaction processed during the simulation.
 *
 * Rules engine consumers receive these as the primary evaluation subject.
 */
export interface Transaction {
    readonly id: string;
    readonly type: TransactionType;
    readonly status: TransactionStatus;
    readonly channel: EventChannel;
    readonly sender: TransactionParty;
    readonly recipient: TransactionParty;
    /** Populated for financial transactions; null for messaging */
    readonly amount: Money | null;
    readonly initiatedAt: string;
    readonly settledAt: string | null;
    readonly expiresAt: string | null;
    /** Reference number from the originating system */
    readonly externalReference: string | null;
    /** Immutable set of labels applied by the rules engine or plugins */
    readonly labels: ReadonlyArray<string>;
    /** Arbitrary extension data provided by the originating plugin */
    readonly extensions: Readonly<Record<string, unknown>>;
}
export type TransactionSummary = Readonly<Pick<Transaction, "id" | "type" | "status" | "channel" | "amount" | "initiatedAt" | "settledAt">>;
