/**
 * @file domain-event.ts
 * @description The base shape for every event that flows through the system.
 *
 * A DomainEvent is the atomic unit of information exchange. Every plugin,
 * backend handler, and rules engine consumer receives and produces these.
 */

import type { EventType } from "./event-types.js";

// ---------------------------------------------------------------------------
// Severity / Priority
// ---------------------------------------------------------------------------

export type EventSeverity = "info" | "warning" | "error" | "critical";
export type EventPriority = "low" | "normal" | "high" | "urgent";

// ---------------------------------------------------------------------------
// Channel / Transport Metadata
// ---------------------------------------------------------------------------

/**
 * Which channel or transport originated this event.
 * Extend this union as new integrations are added.
 */
export type EventChannel =
  | "sms"
  | "whatsapp"
  | "email"
  | "push"
  | "in_app"
  | "api"
  | "internal"
  | "unknown";

// ---------------------------------------------------------------------------
// Event Source
// ---------------------------------------------------------------------------

/** Describes where an event originated — plugin, external service, or internal. */
export interface EventSource {
  /** Identifier of the originating plugin, service, or module */
  readonly id: string;
  /** Human-readable display name of the source */
  readonly name: string;
  /** Version of the plugin/service at time of event emission */
  readonly version: string;
  /** Transport channel that carried the event */
  readonly channel: EventChannel;
}

// ---------------------------------------------------------------------------
// Event Metadata
// ---------------------------------------------------------------------------

/** Immutable envelope metadata attached to every event. */
export interface EventMetadata {
  /** ISO 8601 timestamp at the moment the event was created */
  readonly createdAt: string;
  /** ISO 8601 timestamp at the moment the event was processed (set by engine) */
  readonly processedAt?: string;
  /** Correlation ID to trace a causal chain of events */
  readonly correlationId?: string;
  /** ID of the parent event that caused this one, if any */
  readonly causationId?: string;
  /** Arbitrary tags for filtering, routing, or analytics */
  readonly tags?: ReadonlyArray<string>;
  /** Tenant / account ID for multi-tenant environments */
  readonly tenantId?: string;
}

// ---------------------------------------------------------------------------
// Core DomainEvent
// ---------------------------------------------------------------------------

/**
 * The base domain event structure.
 *
 * All events in the system conform to this interface. Specific event shapes
 * are created by narrowing the `type` field and constraining `payload`.
 *
 * @template TType  - A specific EventType literal (e.g. "message.sent")
 * @template TPayload - The strongly-typed payload for this event
 */
export interface DomainEvent<
  TType extends EventType = EventType,
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Globally unique identifier for this event instance (UUID v4 recommended) */
  readonly id: string;
  /** The event type, drawn from the centralised EventType registry */
  readonly type: TType;
  /** ISO 8601 timestamp of when the event occurred */
  readonly timestamp: string;
  /** Structured payload; never `unknown` — must be fully typed per event */
  readonly payload: TPayload;
  /** The severity level for this event */
  readonly severity: EventSeverity;
  /** The priority level for this event */
  readonly priority: EventPriority;
  /** Who or what emitted this event */
  readonly source: EventSource;
  /** Tracing and routing metadata */
  readonly metadata: EventMetadata;
}

/**
 * Type helper: extract the type from a domain event
 */
export type TypeOf<E extends DomainEvent> = E extends DomainEvent<infer T, any> ? T : never;

/**
 * Type helper: extract the payload from a domain event
 */
export type PayloadOf<E extends DomainEvent> = E extends DomainEvent<any, infer P> ? P : never;

/**
 * Generic typed event alias
 */
export type TypedEvent<T extends EventType, P extends Record<string, unknown>> = DomainEvent<T, P>;

/**
 * Any domain event
 */
export type AnyDomainEvent = DomainEvent<EventType, Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Concrete Event Types
// ---------------------------------------------------------------------------

export type MessageSentEvent = TypedEvent<"message.sent", { messageId: string; recipientPhone: string }>;
export type MessageDeliveredEvent = TypedEvent<"message.delivered", { messageId: string }>;
export type MessageFailedEvent = TypedEvent<"message.failed", { messageId: string; reason: string }>;
export type MessageReadEvent = TypedEvent<"message.read", { messageId: string }>;
export type MessageRetriedEvent = TypedEvent<"message.retried", { messageId: string; attempt: number }>;

export type PaymentInitiatedEvent = TypedEvent<"payment.initiated", { paymentId: string; amount: number }>;
export type PaymentSucceededEvent = TypedEvent<"payment.succeeded", { paymentId: string }>;
export type PaymentFailedEvent = TypedEvent<"payment.failed", { paymentId: string; reason: string }>;
export type PaymentReversedEvent = TypedEvent<"payment.reversed", { paymentId: string }>;
export type PaymentTimeoutEvent = TypedEvent<"payment.timeout", { paymentId: string }>;

export type SessionStartedEvent = TypedEvent<"session.started", { sessionId: string; userId: string }>;
export type SessionEndedEvent = TypedEvent<"session.ended", { sessionId: string }>;

export type RuleFiredEvent = TypedEvent<"rule.fired", { ruleId: string; eventId: string }>;
export type RuleSkippedEvent = TypedEvent<"rule.skipped", { ruleId: string; reason: string }>;
export type RuleErrorEvent = TypedEvent<"rule.error", { ruleId: string; error: string }>;

export type SimulationStartedEvent = TypedEvent<"simulation.started", { simulationId: string }>;
export type SimulationCompletedEvent = TypedEvent<"simulation.completed", { simulationId: string }>;
export type SimulationResetEvent = TypedEvent<"simulation.reset", { simulationId: string }>;


