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
import { isEventType, } from "../events/index.js";
// ---------------------------------------------------------------------------
// Validation Error
// ---------------------------------------------------------------------------
export class ModelValidationError extends Error {
    field;
    received;
    constructor(field, message, received) {
        super(`[ModelValidationError] ${field}: ${message}`);
        this.name = "ModelValidationError";
        this.field = field;
        this.received = received;
    }
}
// ---------------------------------------------------------------------------
// Primitive guards
// ---------------------------------------------------------------------------
export function isString(value) {
    return typeof value === "string";
}
export function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
export function isNumber(value) {
    return typeof value === "number" && !Number.isNaN(value);
}
export function isPositiveInteger(value) {
    return isNumber(value) && Number.isInteger(value) && value > 0;
}
export function isPlainObject(value) {
    return (typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype);
}
export function isArray(value) {
    return Array.isArray(value);
}
export function isISOTimestamp(value) {
    if (!isNonEmptyString(value))
        return false;
    const d = new Date(value);
    return !Number.isNaN(d.getTime()) && value.includes("T");
}
// ---------------------------------------------------------------------------
// Enum guards
// ---------------------------------------------------------------------------
const VALID_SEVERITIES = [
    "info",
    "warning",
    "error",
    "critical",
];
const VALID_PRIORITIES = [
    "low",
    "normal",
    "high",
    "urgent",
];
const VALID_CHANNELS = [
    "sms",
    "whatsapp",
    "email",
    "push",
    "in_app",
    "api",
    "internal",
    "unknown",
];
export function isEventSeverity(value) {
    return (isString(value) &&
        VALID_SEVERITIES.includes(value));
}
export function isEventPriority(value) {
    return (isString(value) &&
        VALID_PRIORITIES.includes(value));
}
export function isEventChannel(value) {
    return (isString(value) && VALID_CHANNELS.includes(value));
}
// ---------------------------------------------------------------------------
// DomainEvent guard
// ---------------------------------------------------------------------------
/**
 * Validates that an unknown value conforms to the DomainEvent interface.
 * Throws `ModelValidationError` on the first failing field.
 */
export function assertDomainEvent(value) {
    if (!isPlainObject(value)) {
        throw new ModelValidationError("root", "must be a plain object", value);
    }
    const required = [
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
        throw new ModelValidationError("type", `must be a valid EventType, got: ${String(value["type"])}`, value["type"]);
    }
    if (!isISOTimestamp(value["timestamp"])) {
        throw new ModelValidationError("timestamp", "must be a valid ISO 8601 timestamp", value["timestamp"]);
    }
    if (!isPlainObject(value["payload"])) {
        throw new ModelValidationError("payload", "must be a plain object", value["payload"]);
    }
    if (!isPlainObject(value["source"])) {
        throw new ModelValidationError("source", "must be a plain object", value["source"]);
    }
    if (!isPlainObject(value["metadata"])) {
        throw new ModelValidationError("metadata", "must be a plain object", value["metadata"]);
    }
    if (!isEventSeverity(value["severity"])) {
        throw new ModelValidationError("severity", `must be one of: ${VALID_SEVERITIES.join(", ")}`, value["severity"]);
    }
    if (!isEventPriority(value["priority"])) {
        throw new ModelValidationError("priority", `must be one of: ${VALID_PRIORITIES.join(", ")}`, value["priority"]);
    }
}
/**
 * Type-guard variant of `assertDomainEvent` — returns boolean instead of throwing.
 */
export function isDomainEvent(value) {
    try {
        assertDomainEvent(value);
        return true;
    }
    catch {
        return false;
    }
}
// ---------------------------------------------------------------------------
// Score guard
// ---------------------------------------------------------------------------
/**
 * Validates that a risk/confidence score is in the [0.0, 1.0] range.
 */
export function isUnitScore(value) {
    return isNumber(value) && value >= 0 && value <= 1;
}
export function assertUnitScore(value, field = "score") {
    if (!isUnitScore(value)) {
        throw new ModelValidationError(field, `must be a number in [0.0, 1.0], got: ${String(value)}`, value);
    }
}
