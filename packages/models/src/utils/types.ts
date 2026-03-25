/**
 * @file types.ts
 * @description Shared utility types used across the entire @models package.
 *
 * These are pure TypeScript-level constructs — no runtime cost.
 */

// ---------------------------------------------------------------------------
// Branded / Opaque Types
// ---------------------------------------------------------------------------

/**
 * Creates a branded type to prevent mixing up semantically different strings
 * or numbers that share the same primitive type.
 *
 * @example
 * type UserId   = Brand<string, "UserId">;
 * type SessionId = Brand<string, "SessionId">;
 *
 * declare const uid: UserId;
 * declare const sid: SessionId;
 * const x: UserId = sid; // ← TypeScript error ✓
 */
export type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

// Common branded ID types used system-wide
export type SimulationId = Brand<string, "SimulationId">;
export type EventId = Brand<string, "EventId">;
export type RuleId = Brand<string, "RuleId">;
export type TraceId = Brand<string, "TraceId">;
export type TransactionId = Brand<string, "TransactionId">;
export type UserId = Brand<string, "UserId">;
export type SessionId = Brand<string, "SessionId">;
export type TenantId = Brand<string, "TenantId">;
export type CorrelationId = Brand<string, "CorrelationId">;
export type DecisionId = Brand<string, "DecisionId">;
export type RevenueEventId = Brand<string, "RevenueEventId">;
export type RiskEventId = Brand<string, "RiskEventId">;

// ---------------------------------------------------------------------------
// ISO 8601 Timestamp
// ---------------------------------------------------------------------------

/**
 * A string guaranteed (by convention) to be a valid ISO 8601 date-time string.
 * Use this instead of bare `string` wherever timestamps are stored.
 */
export type ISOTimestamp = Brand<string, "ISOTimestamp">;

// ---------------------------------------------------------------------------
// Non-empty string / array
// ---------------------------------------------------------------------------

/**
 * Phantom tag ensuring a string is not empty at the type level.
 * Validated at runtime via `assertNonEmpty`.
 */
export type NonEmptyString = Brand<string, "NonEmptyString">;

/** A tuple with at least one element */
export type NonEmptyArray<T> = [T, ...T[]];

// ---------------------------------------------------------------------------
// Result / Either
// ---------------------------------------------------------------------------

/**
 * A discriminated-union Result type.
 * Prefer returning `Result<T, E>` over throwing in the models layer.
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginationParams {
  readonly page: number;
  readonly pageSize: number;
}

export interface PaginatedResult<T> {
  readonly items: ReadonlyArray<T>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

// ---------------------------------------------------------------------------
// Timestamps (struct — useful for entities that track created/updated)
// ---------------------------------------------------------------------------

export interface Timestamps {
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly deletedAt: ISOTimestamp | null;
}

// ---------------------------------------------------------------------------
// Deep Readonly
// ---------------------------------------------------------------------------

/**
 * Recursively makes all properties of T readonly.
 * Useful for ensuring model snapshots are truly immutable at the type level.
 */
export type DeepReadonly<T> = T extends
  | string
  | number
  | boolean
  | null
  | undefined
  | symbol
  | bigint
  ? T
  : T extends ReadonlyArray<infer U>
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

// ---------------------------------------------------------------------------
// Nullable / Optional convenience aliases
// ---------------------------------------------------------------------------

export type Nullable<T> = T | null;
export type Maybe<T> = T | null | undefined;

// ---------------------------------------------------------------------------
// Exhaustive switch helper
// ---------------------------------------------------------------------------

/**
 * Asserts at compile-time that all branches of a switch/union are handled.
 *
 * @example
 * switch (verdict) {
 *   case "allow":  ...
 *   case "block":  ...
 *   default: assertNever(verdict);  // ← error if a new verdict is added and not handled
 * }
 */
export function assertNever(x: never, message?: string): never {
  throw new Error(message ?? `Unhandled case: ${JSON.stringify(x)}`);
}

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly preRelease?: string;
  readonly build?: string;
}


