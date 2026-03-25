/**
 * @file decision-result.ts
 * @description The output produced by the rules engine after evaluating all
 * applicable rules for a given domain event.
 *
 * A DecisionResult is the engine's verdict. It is the only output the rest of
 * the system needs to act on — they do not need to understand the rules.
 */

import type { EventType } from "../events/index.js";
import type { RuleTraceSummary } from "./rule-trace.js";

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/**
 * The engine's top-level verdict for a processed event.
 *
 * - `allow`     — proceed normally
 * - `block`     — halt the action associated with this event
 * - `flag`      — proceed but mark for human review
 * - `transform` — proceed with a modified payload (see transformedPayload)
 * - `defer`     — re-queue for later processing
 * - `error`     — engine encountered an unrecoverable evaluation error
 */
export type DecisionVerdict =
  | "allow"
  | "block"
  | "flag"
  | "transform"
  | "defer"
  | "error";

// ---------------------------------------------------------------------------
// Applied Action
// ---------------------------------------------------------------------------

/**
 * A concrete action applied as a result of the decision.
 * Multiple actions may be applied from different rules in a single decision.
 */
export interface AppliedAction {
  readonly actionId: string;
  readonly actionType: string;
  readonly description: string;
  readonly appliedByRuleId: string;
  readonly appliedByRuleName: string;
  readonly appliedAt: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly succeeded: boolean;
  readonly errorMessage?: string;
}

// ---------------------------------------------------------------------------
// DecisionResult
// ---------------------------------------------------------------------------

/**
 * The complete output of a single rules engine evaluation cycle.
 *
 * One DecisionResult is produced per domain event processed.
 */
export interface DecisionResult {
  /** Unique identifier for this decision */
  readonly decisionId: string;
  /** The event this decision was made for */
  readonly sourceEventId: string;
  readonly sourceEventType: EventType;
  /** ISO 8601 timestamp when the decision was produced */
  readonly decidedAt: string;
  /** Total time taken to reach this decision (sum of all rule evaluations) */
  readonly totalExecutionTimeMs: number;
  /** The engine's top-level verdict */
  readonly verdict: DecisionVerdict;
  /**
   * Human-readable summary explaining the verdict.
   * Must be non-empty — the engine must always justify its decision.
   */
  readonly reason: string;
  /** Confidence score: 0.0 – 1.0.  1.0 = fully deterministic (a rule matched exactly). */
  readonly confidence: number;
  /** Summaries of every rule that contributed to this decision */
  readonly appliedRuleTraces: ReadonlyArray<RuleTraceSummary>;
  /** All concrete actions that were applied */
  readonly appliedActions: ReadonlyArray<AppliedAction>;
  /**
   * If verdict is "transform", the modified payload is stored here.
   * The engine guarantees this is present when verdict === "transform".
   */
  readonly transformedPayload?: Readonly<Record<string, unknown>>;
  /**
   * If verdict is "defer", when the event should be re-queued.
   * ISO 8601 timestamp.
   */
  readonly deferUntil?: string;
  /** Error detail if verdict is "error" */
  readonly engineError?: DecisionEngineError;
}

// ---------------------------------------------------------------------------
// Engine Error
// ---------------------------------------------------------------------------

export interface DecisionEngineError {
  readonly message: string;
  readonly code: string;
  readonly faultingRuleId?: string;
  readonly recoverable: boolean;
}

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

/** Narrows a DecisionResult to one where the verdict is a specific value */
export type DecisionResultWithVerdict<V extends DecisionVerdict> =
  DecisionResult & { readonly verdict: V };

/** Convenience alias: a blocked decision */
export type BlockedDecision = DecisionResultWithVerdict<"block">;

/** Convenience alias: a flagged decision */
export type FlaggedDecision = DecisionResultWithVerdict<"flag">;


