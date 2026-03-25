/**
 * @file types.ts
 * @description Shared utility types used across the entire @models package.
 *
 * These are pure TypeScript-level constructs — no runtime cost.
 */
export function ok(value) {
    return { ok: true, value };
}
export function err(error) {
    return { ok: false, error };
}
export function isOk(result) {
    return result.ok;
}
export function isErr(result) {
    return !result.ok;
}
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
export function assertNever(x, message) {
    throw new Error(message ?? `Unhandled case: ${JSON.stringify(x)}`);
}
