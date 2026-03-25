/**
 * @file rule-trace.ts
 * @description An immutable audit record of a single rule evaluation.
 *
 * Every time the rules engine evaluates a rule — whether it fires, is skipped,
 * or errors — a RuleTrace is appended to SimulationState. This is the primary
 * mechanism for explainability and debugging.
 */

import type { EventType } from "../events/index.js";

// ---------------------------------------------------------------------------
// Rule Outcome
// ---------------------------------------------------------------------------

export type RuleOutcome =
  | "fired"      // Rule condition matched and action was applied
  | "skipped"    // Rule was not applicable to this event (pre-condition failed)
  | "no_match"   // Rule was evaluated but condition was false
  | "error"      // Rule threw during evaluation
  | "disabled";  // Rule exists but is administratively disabled

// ---------------------------------------------------------------------------
// Condition Trace
// ---------------------------------------------------------------------------

/**
 * A snapshot of a single condition evaluated within a rule.
 * Enables leaf-level explainability for complex compound rules.
 */
export interface ConditionTrace {
  /** Human-readable description of this condition */
  readonly description: string;
  /** The actual value that was tested */
  readonly actualValue: unknown;
  /** The expected value or threshold */
  readonly expectedValue: unknown;
  /** Whether this individual condition passed */
  readonly passed: boolean;
  /** Logical operator connecting this to the next condition, if any */
  readonly operator?: "AND" | "OR";
}

// ---------------------------------------------------------------------------
// Action Trace
// ---------------------------------------------------------------------------

/**
 * A record of an action that was (or would have been) executed by a rule.
 */
export interface ActionTrace {
  readonly actionType: string;
  readonly description: string;
  readonly executed: boolean;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly errorMessage?: string;
}

// ---------------------------------------------------------------------------
// RuleTrace
// ---------------------------------------------------------------------------

/**
 * Complete audit record for one rule evaluation cycle.
 */
export interface RuleTrace {
  /** Unique identifier for this trace record */
  readonly traceId: string;
  /** The rule that was evaluated */
  readonly ruleId: string;
  readonly ruleName: string;
  readonly ruleVersion: string;
  /** The event that triggered this evaluation */
  readonly triggeringEventId: string;
  readonly triggeringEventType: EventType;
  /** ISO 8601 timestamp when evaluation began */
  readonly evaluatedAt: string;
  /** How long the evaluation took */
  readonly executionTimeMs: number;
  /** Final outcome of this rule evaluation */
  readonly outcome: RuleOutcome;
  /** Human-readable explanation of why this outcome was reached */
  readonly explanation: string;
  /** Breakdown of each condition that was evaluated */
  readonly conditions: ReadonlyArray<ConditionTrace>;
  /** Actions that were run (or attempted) as a result of this rule */
  readonly actions: ReadonlyArray<ActionTrace>;
  /** Any error information if outcome is "error" */
  readonly error?: RuleTraceError;
  /** Arbitrary context values captured at evaluation time (for debugging) */
  readonly contextSnapshot: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Error Detail
// ---------------------------------------------------------------------------

export interface RuleTraceError {
  readonly message: string;
  readonly code: string;
  readonly stackTrace?: string;
}

// ---------------------------------------------------------------------------
// Summary projection
// ---------------------------------------------------------------------------

export type RuleTraceSummary = Readonly<
  Pick<
    RuleTrace,
    | "traceId"
    | "ruleId"
    | "ruleName"
    | "triggeringEventType"
    | "evaluatedAt"
    | "executionTimeMs"
    | "outcome"
    | "explanation"
  >
>;


