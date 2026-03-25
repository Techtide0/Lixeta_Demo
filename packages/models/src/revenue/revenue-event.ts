/**
 * @file revenue-event.ts
 * @description Tracks every revenue impact — positive or negative — that the
 * simulation generates.
 *
 * Revenue events are produced by the rules engine or plugins and accumulated
 * on SimulationState. The analytics layer reads these to produce P&L summaries.
 */

import type { EventType } from "../events/index.js";
import type { Money } from "../entities/transaction.js";

// ---------------------------------------------------------------------------
// Revenue Category
// ---------------------------------------------------------------------------

/**
 * High-level category for grouping revenue impacts in reports.
 */
export type RevenueCategory =
  | "sms_saved"          // Cost saved by avoiding a billable SMS
  | "sms_cost"           // Cost incurred for sending an SMS
  | "transaction_fee"    // Fee earned or paid on a payment
  | "interchange"        // Interchange revenue on a card payment
  | "penalty"            // Fine or penalty incurred
  | "refund"             // Revenue returned to a customer
  | "bonus"              // Incentive or bonus earned
  | "subscription"       // Subscription revenue recognised
  | "other";             // Catch-all; should be minimised

// ---------------------------------------------------------------------------
// Impact Direction
// ---------------------------------------------------------------------------

export type RevenueImpactDirection = "gain" | "loss" | "neutral";

// ---------------------------------------------------------------------------
// RevenueEvent
// ---------------------------------------------------------------------------

/**
 * A single revenue impact record.
 *
 * Always tied to a specific domain event and, optionally, to the rule that
 * triggered the accounting entry.
 */
export interface RevenueEvent {
  /** Unique ID for this revenue record */
  readonly id: string;
  /** ISO 8601 timestamp when this impact was recorded */
  readonly recordedAt: string;
  /** The domain event that caused this revenue impact */
  readonly triggeringEventId: string;
  readonly triggeringEventType: EventType;
  /** The rule responsible, if applicable */
  readonly triggeringRuleId: string | null;
  readonly triggeringRuleName: string | null;
  /** Category for grouping and filtering */
  readonly category: RevenueCategory;
  /** Whether this is a gain or a loss */
  readonly direction: RevenueImpactDirection;
  /** The monetary value of the impact */
  readonly amount: Money;
  /** Human-readable description of what caused this impact */
  readonly description: string;
  /**
   * Optional reference to an external accounting system.
   * Useful when integrating with billing or ERP systems.
   */
  readonly externalRef?: string;
  /** Arbitrary metadata for downstream analytics */
  readonly metadata: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Revenue Aggregate (computed summary — not stored, derived on read)
// ---------------------------------------------------------------------------

export interface RevenueAggregate {
  readonly totalGainMinorUnits: number;
  readonly totalLossMinorUnits: number;
  readonly netMinorUnits: number;
  readonly currency: string;
  readonly eventCount: number;
  readonly byCategory: Readonly<
    Partial<
      Record<
        RevenueCategory,
        { readonly gainMinorUnits: number; readonly lossMinorUnits: number }
      >
    >
  >;
}


