/**
 * @file factories.ts
 * @description Pure factory functions for constructing model instances.
 *
 * These functions:
 *   - Accept partial/raw input and return fully-typed, validated objects
 *   - Guarantee all required fields are present
 *   - Apply sensible defaults so callers don't repeat boilerplate
 *   - Are the ONLY place where model objects should be constructed
 *
 * They do NOT persist, mutate global state, or have side effects.
 */

import type {
  DomainEvent,
  EventSource,
  EventMetadata,
  EventSeverity,
  EventPriority,
  EventChannel,
  EventType,
} from "../events/index.js";

import type {
  SimulationState,
  SimulationConfig,
  SimulationCounters,
  SimulationTiming,
} from "../entities/simulation-state.js";

import type { RevenueEvent, RevenueCategory, RevenueImpactDirection } from "../revenue/revenue-event.js";
import type { RiskEvent, RiskCategory, RiskSeverity, RiskEvidence } from "../risk/risk-event.js";
import type { DecisionResult, DecisionVerdict, AppliedAction } from "../rules/decision-result.js";
import type { RuleTrace, RuleOutcome, ConditionTrace, ActionTrace } from "../rules/rule-trace.js";
import type { Money } from "../entities/transaction.js";
import type { ISOTimestamp } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function nowISO(): ISOTimestamp {
  return new Date().toISOString() as ISOTimestamp;
}

// ---------------------------------------------------------------------------
// EventSource factory
// ---------------------------------------------------------------------------

export function createEventSource(
  overrides: Partial<EventSource> & Pick<EventSource, "id" | "name">
): EventSource {
  return {
    version: "1.0.0",
    channel: "internal" satisfies EventChannel,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// EventMetadata factory
// ---------------------------------------------------------------------------

export function createEventMetadata(
  overrides?: Partial<EventMetadata>
): EventMetadata {
  return {
    createdAt: nowISO(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DomainEvent factory
// ---------------------------------------------------------------------------

export interface CreateDomainEventInput<
  TType extends EventType,
  TPayload extends Record<string, unknown>,
> {
  readonly id: string;
  readonly type: TType;
  readonly payload: TPayload;
  readonly source: EventSource;
  readonly timestamp?: string;
  readonly severity?: EventSeverity;
  readonly priority?: EventPriority;
  readonly metadata?: Partial<EventMetadata>;
}

export function createDomainEvent<
  TType extends EventType,
  TPayload extends Record<string, unknown>,
>(
  input: CreateDomainEventInput<TType, TPayload>
): DomainEvent<TType, TPayload> {
  return {
    id: input.id,
    type: input.type,
    timestamp: input.timestamp ?? nowISO(),
    payload: input.payload,
    source: input.source,
    severity: input.severity ?? "info",
    priority: input.priority ?? "normal",
    metadata: createEventMetadata(input.metadata),
  };
}

// ---------------------------------------------------------------------------
// SimulationState factory
// ---------------------------------------------------------------------------

export function createInitialSimulationState(
  id: string,
  config: SimulationConfig
): SimulationState {
  const counters: SimulationCounters = {
    totalEventsProcessed: 0,
    totalRulesFired: 0,
    totalRulesSkipped: 0,
    totalRuleErrors: 0,
    totalTransactions: 0,
    totalDecisions: 0,
    eventCountByType: {},
  };

  const timing: SimulationTiming = {
    startedAt: null,
    pausedAt: null,
    completedAt: null,
    totalPausedMs: 0,
    elapsedMs: 0,
  };

  return {
    id,
    config,
    status: "idle",
    timing,
    events: [],
    revenueEvents: [],
    riskEvents: [],
    ruleTraces: [],
    decisions: {},
    counters,
    lastError: null,
  };
}

// ---------------------------------------------------------------------------
// Money factory
// ---------------------------------------------------------------------------

export function createMoney(
  amountMinorUnits: number,
  currency: string
): Money {
  return { amountMinorUnits, currency: currency.toUpperCase() };
}

// ---------------------------------------------------------------------------
// RevenueEvent factory
// ---------------------------------------------------------------------------

export interface CreateRevenueEventInput {
  readonly id: string;
  readonly triggeringEventId: string;
  readonly triggeringEventType: EventType;
  readonly category: RevenueCategory;
  readonly direction: RevenueImpactDirection;
  readonly amount: Money;
  readonly description: string;
  readonly triggeringRuleId?: string;
  readonly triggeringRuleName?: string;
  readonly externalRef?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function createRevenueEvent(
  input: CreateRevenueEventInput
): RevenueEvent {
  const base: RevenueEvent = {
    id: input.id,
    recordedAt: nowISO(),
    triggeringEventId: input.triggeringEventId,
    triggeringEventType: input.triggeringEventType,
    triggeringRuleId: input.triggeringRuleId ?? null,
    triggeringRuleName: input.triggeringRuleName ?? null,
    category: input.category,
    direction: input.direction,
    amount: input.amount,
    description: input.description,
    metadata: input.metadata ?? {},
  };
  if (input.externalRef !== undefined) {
    return { ...base, externalRef: input.externalRef };
  }
  return base;
}

// ---------------------------------------------------------------------------
// RiskEvent factory
// ---------------------------------------------------------------------------

export interface CreateRiskEventInput {
  readonly id: string;
  readonly triggeringEventId: string;
  readonly triggeringEventType: EventType;
  readonly category: RiskCategory;
  readonly severity: RiskSeverity;
  readonly score: number;
  readonly description: string;
  readonly evidence: RiskEvidence;
  readonly triggeringRuleId?: string;
  readonly triggeringRuleName?: string;
}

export function createRiskEvent(input: CreateRiskEventInput): RiskEvent {
  return {
    id: input.id,
    detectedAt: nowISO(),
    triggeringEventId: input.triggeringEventId,
    triggeringEventType: input.triggeringEventType,
    triggeringRuleId: input.triggeringRuleId ?? null,
    triggeringRuleName: input.triggeringRuleName ?? null,
    category: input.category,
    severity: input.severity,
    status: "open",
    score: input.score,
    description: input.description,
    evidence: input.evidence,
  };
}

// ---------------------------------------------------------------------------
// RuleTrace factory
// ---------------------------------------------------------------------------

export interface CreateRuleTraceInput {
  readonly traceId: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly ruleVersion: string;
  readonly triggeringEventId: string;
  readonly triggeringEventType: EventType;
  readonly executionTimeMs: number;
  readonly outcome: RuleOutcome;
  readonly explanation: string;
  readonly conditions: ReadonlyArray<ConditionTrace>;
  readonly actions: ReadonlyArray<ActionTrace>;
  readonly contextSnapshot?: Readonly<Record<string, unknown>>;
}

export function createRuleTrace(input: CreateRuleTraceInput): RuleTrace {
  return {
    traceId: input.traceId,
    ruleId: input.ruleId,
    ruleName: input.ruleName,
    ruleVersion: input.ruleVersion,
    triggeringEventId: input.triggeringEventId,
    triggeringEventType: input.triggeringEventType,
    evaluatedAt: nowISO(),
    executionTimeMs: input.executionTimeMs,
    outcome: input.outcome,
    explanation: input.explanation,
    conditions: input.conditions,
    actions: input.actions,
    contextSnapshot: input.contextSnapshot ?? {},
  };
}

// ---------------------------------------------------------------------------
// DecisionResult factory
// ---------------------------------------------------------------------------

export interface CreateDecisionResultInput {
  readonly decisionId: string;
  readonly sourceEventId: string;
  readonly sourceEventType: EventType;
  readonly totalExecutionTimeMs: number;
  readonly verdict: DecisionVerdict;
  readonly reason: string;
  readonly confidence: number;
  readonly appliedRuleTraces?: DecisionResult["appliedRuleTraces"];
  readonly appliedActions?: ReadonlyArray<AppliedAction>;
  readonly transformedPayload?: Readonly<Record<string, unknown>>;
  readonly deferUntil?: string;
  readonly engineError?: DecisionResult["engineError"];
}

export function createDecisionResult(
  input: CreateDecisionResultInput
): DecisionResult {
  const base: DecisionResult = {
    decisionId: input.decisionId,
    sourceEventId: input.sourceEventId,
    sourceEventType: input.sourceEventType,
    decidedAt: nowISO(),
    totalExecutionTimeMs: input.totalExecutionTimeMs,
    verdict: input.verdict,
    reason: input.reason,
    confidence: input.confidence,
    appliedRuleTraces: input.appliedRuleTraces ?? [],
    appliedActions: input.appliedActions ?? [],
  };
  const mutable = base as unknown as Record<string, unknown>;
  if (input.transformedPayload !== undefined) {
    mutable["transformedPayload"] = input.transformedPayload;
  }
  if (input.deferUntil !== undefined) {
    mutable["deferUntil"] = input.deferUntil;
  }
  if (input.engineError !== undefined) {
    mutable["engineError"] = input.engineError;
  }
  return base;
}


