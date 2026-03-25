/**
 * @file index.ts
 * @description Utils module: types, validators, and factories
 */

export type {
  Brand,
  SimulationId,
  EventId,
  RuleId,
  TraceId,
  TransactionId,
  UserId,
  SessionId,
  TenantId,
  CorrelationId,
  DecisionId,
  RevenueEventId,
  RiskEventId,
  ISOTimestamp,
  NonEmptyString,
  NonEmptyArray,
  Result,
  PaginationParams,
  PaginatedResult,
  Timestamps,
  DeepReadonly,
  Nullable,
  Maybe,
  SemVer,
} from "./types.js";

export {
  ok,
  err,
  isOk,
  isErr,
  assertNever,
} from "./types.js";

export {
  ModelValidationError,
  isString,
  isNonEmptyString,
  isNumber,
  isPositiveInteger,
  isPlainObject,
  isArray,
  isISOTimestamp,
  isEventSeverity,
  isEventPriority,
  isEventChannel,
  assertDomainEvent,
  isDomainEvent,
  isUnitScore,
  assertUnitScore,
} from "./validators.js";

export {
  createEventSource,
  createEventMetadata,
  createDomainEvent,
  createInitialSimulationState,
  createMoney,
  createRevenueEvent,
  createRiskEvent,
  createRuleTrace,
  createDecisionResult,
  type CreateDomainEventInput,
  type CreateRevenueEventInput,
  type CreateRiskEventInput,
  type CreateRuleTraceInput,
  type CreateDecisionResultInput,
} from "./factories.js";


