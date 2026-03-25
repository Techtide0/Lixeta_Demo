/**
 * @file validators.ts
 * @description Runtime validation guards for the core domain models.
 *
 * These functions bridge the gap between the TypeScript type system and
 * untrusted data arriving at system boundaries (API input, plugin output,
 * deserialised storage). They are the only place in @models where runtime
 * logic lives beyond pure type helpers.
 *
 * Every guard follows the same contract:
 *   - Takes `unknown` as input
 *   - Returns a type predicate or throws a `ModelValidationError`
 */

import {
  isEventType,
  type EventType,
  type DomainEvent,
  type EventSeverity,
  type EventPriority,
  type EventChannel,
} from "../events/index.js";

// ---------------------------------------------------------------------------
// Validation Error
// ---------------------------------------------------------------------------

export class ModelValidationError extends Error {
  public readonly field: string;
  public readonly received: unknown;

  constructor(field: string, message: string, received?: unknown) {
    super(`[ModelValidationError] ${field}: ${message}`);
    this.name = "ModelValidationError";
    this.field = field;
    this.received = received;
  }
}

// ---------------------------------------------------------------------------
// Primitive guards
// ---------------------------------------------------------------------------

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

export function isPositiveInteger(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value > 0;
}

export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isISOTimestamp(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && value.includes("T");
}

// ---------------------------------------------------------------------------
// Enum guards
// ---------------------------------------------------------------------------

const VALID_SEVERITIES: ReadonlyArray<EventSeverity> = [
  "info",
  "warning",
  "error",
  "critical",
];

const VALID_PRIORITIES: ReadonlyArray<EventPriority> = [
  "low",
  "normal",
  "high",
  "urgent",
];

const VALID_CHANNELS: ReadonlyArray<EventChannel> = [
  "sms",
  "whatsapp",
  "email",
  "push",
  "in_app",
  "api",
  "internal",
  "unknown",
];

export function isEventSeverity(value: unknown): value is EventSeverity {
  return (
    isString(value) &&
    (VALID_SEVERITIES as readonly string[]).includes(value)
  );
}

export function isEventPriority(value: unknown): value is EventPriority {
  return (
    isString(value) &&
    (VALID_PRIORITIES as readonly string[]).includes(value)
  );
}

export function isEventChannel(value: unknown): value is EventChannel {
  return (
    isString(value) && (VALID_CHANNELS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// DomainEvent guard
// ---------------------------------------------------------------------------

/**
 * Validates that an unknown value conforms to the DomainEvent interface.
 * Throws `ModelValidationError` on the first failing field.
 */
export function assertDomainEvent(value: unknown): asserts value is DomainEvent {
  if (!isPlainObject(value)) {
    throw new ModelValidationError("root", "must be a plain object", value);
  }

  const required: ReadonlyArray<string> = [
    "id",
    "type",
    "timestamp",
    "payload",
    "source",
    "metadata",
    "severity",
    "priority",
  ];

  for (const key of required) {
    if (!(key in value)) {
      throw new ModelValidationError(key, `field is required`, undefined);
    }
  }

  if (!isNonEmptyString(value["id"])) {
    throw new ModelValidationError("id", "must be a non-empty string", value["id"]);
  }

  if (!isEventType(value["type"])) {
    throw new ModelValidationError(
      "type",
      `must be a valid EventType, got: ${String(value["type"])}`,
      value["type"]
    );
  }

  if (!isISOTimestamp(value["timestamp"])) {
    throw new ModelValidationError(
      "timestamp",
      "must be a valid ISO 8601 timestamp",
      value["timestamp"]
    );
  }

  if (!isPlainObject(value["payload"])) {
    throw new ModelValidationError(
      "payload",
      "must be a plain object",
      value["payload"]
    );
  }

  if (!isPlainObject(value["source"])) {
    throw new ModelValidationError(
      "source",
      "must be a plain object",
      value["source"]
    );
  }

  if (!isPlainObject(value["metadata"])) {
    throw new ModelValidationError(
      "metadata",
      "must be a plain object",
      value["metadata"]
    );
  }

  if (!isEventSeverity(value["severity"])) {
    throw new ModelValidationError(
      "severity",
      `must be one of: ${VALID_SEVERITIES.join(", ")}`,
      value["severity"]
    );
  }

  if (!isEventPriority(value["priority"])) {
    throw new ModelValidationError(
      "priority",
      `must be one of: ${VALID_PRIORITIES.join(", ")}`,
      value["priority"]
    );
  }
}

/**
 * Type-guard variant of `assertDomainEvent` — returns boolean instead of throwing.
 */
export function isDomainEvent(value: unknown): value is DomainEvent {
  try {
    assertDomainEvent(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Score guard
// ---------------------------------------------------------------------------

/**
 * Validates that a risk/confidence score is in the [0.0, 1.0] range.
 */
export function isUnitScore(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value <= 1;
}

export function assertUnitScore(
  value: unknown,
  field = "score"
): asserts value is number {
  if (!isUnitScore(value)) {
    throw new ModelValidationError(
      field,
      `must be a number in [0.0, 1.0], got: ${String(value)}`,
      value
    );
  }
}


