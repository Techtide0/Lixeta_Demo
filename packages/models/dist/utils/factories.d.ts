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
import type { DomainEvent, EventSource, EventMetadata, EventSeverity, EventPriority, EventType } from "../events/index.js";
import type { SimulationState, SimulationConfig } from "../entities/simulation-state.js";
import type { RevenueEvent, RevenueCategory, RevenueImpactDirection } from "../revenue/revenue-event.js";
import type { RiskEvent, RiskCategory, RiskSeverity, RiskEvidence } from "../risk/risk-event.js";
import type { DecisionResult, DecisionVerdict, AppliedAction } from "../rules/decision-result.js";
import type { RuleTrace, RuleOutcome, ConditionTrace, ActionTrace } from "../rules/rule-trace.js";
import type { Money } from "../entities/transaction.js";
export declare function createEventSource(overrides: Partial<EventSource> & Pick<EventSource, "id" | "name">): EventSource;
export declare function createEventMetadata(overrides?: Partial<EventMetadata>): EventMetadata;
export interface CreateDomainEventInput<TType extends EventType, TPayload extends Record<string, unknown>> {
    readonly id: string;
    readonly type: TType;
    readonly payload: TPayload;
    readonly source: EventSource;
    readonly timestamp?: string;
    readonly severity?: EventSeverity;
    readonly priority?: EventPriority;
    readonly metadata?: Partial<EventMetadata>;
}
export declare function createDomainEvent<TType extends EventType, TPayload extends Record<string, unknown>>(input: CreateDomainEventInput<TType, TPayload>): DomainEvent<TType, TPayload>;
export declare function createInitialSimulationState(id: string, config: SimulationConfig): SimulationState;
export declare function createMoney(amountMinorUnits: number, currency: string): Money;
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
export declare function createRevenueEvent(input: CreateRevenueEventInput): RevenueEvent;
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
export declare function createRiskEvent(input: CreateRiskEventInput): RiskEvent;
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
export declare function createRuleTrace(input: CreateRuleTraceInput): RuleTrace;
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
export declare function createDecisionResult(input: CreateDecisionResultInput): DecisionResult;
