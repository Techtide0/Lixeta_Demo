/**
 * @file simulation-state.ts
 * @description The top-level session container.
 *
 * SimulationState is the single source of truth for a running or completed
 * simulation. The engine reads from and writes to this structure exclusively.
 */

import type { DomainEvent, EventType } from "../events/index.js";
import type { RevenueEvent } from "../revenue/revenue-event.js";
import type { RiskEvent } from "../risk/risk-event.js";
import type { RuleTrace } from "../rules/rule-trace.js";
import type { DecisionResult } from "../rules/decision-result.js";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type SimulationStatus =
  | "idle"
  | "initializing"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "reset";

// ---------------------------------------------------------------------------
// Configuration Snapshot
// ---------------------------------------------------------------------------

/**
 * Immutable snapshot of the configuration that was active when the simulation
 * started. Stored alongside state so replays are deterministic.
 */
export interface SimulationConfig {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly maxEvents: number;
  readonly timeoutMs: number;
  readonly enabledRules: ReadonlyArray<string>;
  readonly pluginIds: ReadonlyArray<string>;
  readonly seed?: number;
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

/** Aggregate counters tracked during the simulation run. */
export interface SimulationCounters {
  readonly totalEventsProcessed: number;
  readonly totalRulesFired: number;
  readonly totalRulesSkipped: number;
  readonly totalRuleErrors: number;
  readonly totalTransactions: number;
  readonly totalDecisions: number;
  readonly eventCountByType: Readonly<Partial<Record<EventType, number>>>;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export interface SimulationTiming {
  readonly startedAt: string | null;
  readonly pausedAt: string | null;
  readonly completedAt: string | null;
  readonly totalPausedMs: number;
  readonly elapsedMs: number;
}

// ---------------------------------------------------------------------------
// SimulationState
// ---------------------------------------------------------------------------

/**
 * Holds the complete state of a simulation session.
 *
 * This is intentionally a plain-data structure (no methods) so it can be
 * serialised, diffed, and replayed without special handling.
 */
export interface SimulationState {
  /** Globally unique simulation run identifier */
  readonly id: string;
  /** The configuration this simulation was started with */
  readonly config: SimulationConfig;
  /** Lifecycle status of the simulation */
  readonly status: SimulationStatus;
  /** Timing information */
  readonly timing: SimulationTiming;
  /** Ordered log of all domain events processed in this session */
  readonly events: ReadonlyArray<DomainEvent>;
  /** All revenue impact records generated during the session */
  readonly revenueEvents: ReadonlyArray<RevenueEvent>;
  /** All risk impact records generated during the session */
  readonly riskEvents: ReadonlyArray<RiskEvent>;
  /** Full trace log of every rule evaluation */
  readonly ruleTraces: ReadonlyArray<RuleTrace>;
  /** Final decisions produced by the rules engine, keyed by originating event ID */
  readonly decisions: Readonly<Record<string, DecisionResult>>;
  /** Aggregate counters */
  readonly counters: SimulationCounters;
  /** Most recent error, if status is "failed" */
  readonly lastError: SimulationError | null;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export interface SimulationError {
  readonly message: string;
  readonly code: string;
  readonly occurredAt: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// State Transitions (type-safe, no mutation)
// ---------------------------------------------------------------------------

/**
 * A partial update that can be merged into SimulationState.
 * Used by reducers / handlers to express state changes immutably.
 */
export type SimulationStateUpdate = Readonly<
  Partial<Omit<SimulationState, "id" | "config">>
>;


