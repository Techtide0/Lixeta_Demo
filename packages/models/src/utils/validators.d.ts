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
import { type DomainEvent, type EventSeverity, type EventPriority, type EventChannel } from "../events/index.js";
export declare class ModelValidationError extends Error {
    readonly field: string;
    readonly received: unknown;
    constructor(field: string, message: string, received?: unknown);
}
export declare function isString(value: unknown): value is string;
export declare function isNonEmptyString(value: unknown): value is string;
export declare function isNumber(value: unknown): value is number;
export declare function isPositiveInteger(value: unknown): value is number;
export declare function isPlainObject(value: unknown): value is Record<string, unknown>;
export declare function isArray(value: unknown): value is unknown[];
export declare function isISOTimestamp(value: unknown): value is string;
export declare function isEventSeverity(value: unknown): value is EventSeverity;
export declare function isEventPriority(value: unknown): value is EventPriority;
export declare function isEventChannel(value: unknown): value is EventChannel;
/**
 * Validates that an unknown value conforms to the DomainEvent interface.
 * Throws `ModelValidationError` on the first failing field.
 */
export declare function assertDomainEvent(value: unknown): asserts value is DomainEvent;
/**
 * Type-guard variant of `assertDomainEvent` — returns boolean instead of throwing.
 */
export declare function isDomainEvent(value: unknown): value is DomainEvent;
/**
 * Validates that a risk/confidence score is in the [0.0, 1.0] range.
 */
export declare function isUnitScore(value: unknown): value is number;
export declare function assertUnitScore(value: unknown, field?: string): asserts value is number;
