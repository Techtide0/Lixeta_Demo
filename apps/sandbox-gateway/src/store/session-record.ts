/**
 * @file store/session-record.ts
 * @description The data shape persisted for each active session.
 *
 * Design decisions
 * ────────────────
 * • `SessionRecord` wraps `SimulationState` and adds session-lifecycle metadata
 *   that the engine does not need to know about (created/updated timestamps,
 *   client-provided metadata, access count).
 * • The engine's `SimulationState` is stored immutably — only the store's
 *   `applyEngineOutput()` function may produce a new state. This is the
 *   single mutation point for session state.
 * • `sequenceCounter` is a monotonic integer. Every event appended to a
 *   session gets the next sequence number. This ensures deterministic ordering
 *   even if two events arrive with identical millisecond timestamps.
 * • `metadata` is client-supplied and stored verbatim. It is NEVER evaluated
 *   by rules or reflected into engine config — it is purely for logging and
 *   analytics queries.
 *
 * Security notes
 * ──────────────
 * • `clientMetadata` is validated for size and key count at the API layer
 *   before reaching here. This struct trusts that its caller has validated.
 * • `accessCount` is used for anomaly detection — sessions with unusually high
 *   access counts can be flagged by a future security rule.
 * • `expiresAt` is set at creation and enforced by the store's GC. Sessions
 *   are not accessible after expiry regardless of any other field.
 */

import type {
  SimulationState,
  DomainEvent,
  RevenueEvent,
  RiskEvent,
  RuleTrace,
} from "@lixeta/models";

import type { EngineEvaluationOutput } from "@lixeta/rules-engine";

// ---------------------------------------------------------------------------
// Client-supplied session metadata
// ---------------------------------------------------------------------------

export interface SessionMetadata {
  /** Optional label for display in dashboards */
  readonly label?: string;
  /** Client-defined environment tag (e.g. "staging", "prod-test") */
  readonly environment?: string;
  /** Free-form tags for filtering */
  readonly tags?: ReadonlyArray<string>;
  /** Caller-supplied user or tenant reference — NOT used by the engine */
  readonly ownerId?: string;
}

// ---------------------------------------------------------------------------
// Session status
// ---------------------------------------------------------------------------

export type SessionStatus =
  | "active"     // receiving events normally
  | "paused"     // no new events accepted until resumed
  | "completed"  // client explicitly closed the session
  | "expired"    // TTL elapsed; GC will remove it
  | "error";     // unrecoverable engine error in this session

// ---------------------------------------------------------------------------
// SessionRecord
// ---------------------------------------------------------------------------

export interface SessionRecord {
  /** Unique session identifier */
  readonly sessionId: string;

  /** ISO 8601 creation timestamp */
  readonly createdAt: string;

  /** ISO 8601 last-modified timestamp (updated on every event) */
  readonly updatedAt: string;

  /** ISO 8601 expiry timestamp — session is inaccessible after this */
  readonly expiresAt: string;

  /** Current lifecycle status */
  readonly status: SessionStatus;

  /** Monotonic counter — incremented on every appended event */
  readonly sequenceCounter: number;

  /** Client-supplied metadata — never evaluated by the engine */
  readonly clientMetadata: SessionMetadata;

  /** IP address of the session creator (hashed for PII compliance) */
  readonly creatorIpHash: string;

  /** Total number of times this session has been accessed */
  readonly accessCount: number;

  /**
   * The current simulation state for this session.
   * Holds the accumulated events, revenue, risk, traces, and decisions.
   */
  readonly state: SimulationState;

  /**
   * Engine aggression level for this session (0–100, default 50).
   * Injected into EngineConfig on every event evaluation.
   */
  readonly aggressionLevel: number;
}

// ---------------------------------------------------------------------------
// Immutable update helpers
// ---------------------------------------------------------------------------

/**
 * Produce a new SessionRecord by merging engine output into the current state.
 *
 * This is the ONLY function allowed to produce a new session state.
 * It never mutates the existing record — it returns a completely new object.
 */
export function applyEngineOutput(
  record: SessionRecord,
  event: DomainEvent,
  output: EngineEvaluationOutput,
  now: string
): SessionRecord {
  const newState: SimulationState = {
    ...record.state,
    status: "running",
    events: [...record.state.events, event],
    revenueEvents: [...record.state.revenueEvents, ...output.revenueEvents],
    riskEvents: [...record.state.riskEvents, ...output.riskEvents],
    ruleTraces: [...record.state.ruleTraces, ...output.ruleTraces],
    decisions: {
      ...record.state.decisions,
      [event.id]: output.decision,
    },
    counters: updateCounters(record.state, event, output),
    timing: updateTiming(record.state, now),
  };

  return {
    ...record,
    updatedAt: now,
    status: deriveSessionStatus(output),
    sequenceCounter: record.sequenceCounter + 1,
    accessCount: record.accessCount + 1,
    state: newState,
  };
}

/** Record a read-access (increments accessCount, updates updatedAt). */
export function recordAccess(record: SessionRecord, now: string): SessionRecord {
  return {
    ...record,
    updatedAt: now,
    accessCount: record.accessCount + 1,
  };
}

/** Mark session as completed by the client. */
export function markCompleted(record: SessionRecord, now: string): SessionRecord {
  return {
    ...record,
    updatedAt: now,
    status: "completed",
    state: {
      ...record.state,
      status: "completed",
      timing: {
        ...record.state.timing,
        completedAt: now,
        elapsedMs: Date.now() - new Date(record.createdAt).getTime(),
      },
    },
  };
}

/** Mark session as expired. */
export function markExpired(record: SessionRecord, now: string): SessionRecord {
  return {
    ...record,
    updatedAt: now,
    status: "expired",
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

import type {
  SimulationCounters,
  SimulationTiming,
  EventType,
} from "@lixeta/models";

function updateCounters(
  state: SimulationState,
  event: DomainEvent,
  output: EngineEvaluationOutput
): SimulationCounters {
  const existing = state.counters.eventCountByType[event.type as EventType] ?? 0;
  return {
    totalEventsProcessed: state.counters.totalEventsProcessed + 1,
    totalRulesFired:
      state.counters.totalRulesFired +
      output.ruleTraces.filter((t) => t.outcome === "fired").length,
    totalRulesSkipped:
      state.counters.totalRulesSkipped +
      output.ruleTraces.filter((t) => t.outcome === "skipped").length,
    totalRuleErrors:
      state.counters.totalRuleErrors +
      output.ruleTraces.filter((t) => t.outcome === "error").length,
    totalTransactions: state.counters.totalTransactions,
    totalDecisions: state.counters.totalDecisions + 1,
    eventCountByType: {
      ...state.counters.eventCountByType,
      [event.type]: existing + 1,
    },
  };
}

function updateTiming(state: SimulationState, now: string): SimulationTiming {
  return {
    ...state.timing,
    startedAt: state.timing.startedAt ?? now,
    elapsedMs: state.timing.startedAt
      ? Date.now() - new Date(state.timing.startedAt).getTime()
      : 0,
  };
}

function deriveSessionStatus(output: EngineEvaluationOutput): SessionStatus {
  if (output.decision.verdict === "error") return "error";
  return "active";
}
