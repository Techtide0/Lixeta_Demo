/**
 * @file evaluation-context.ts
 * @description The read-only context object passed to every rule.
 *
 * Security notes
 * ──────────────
 * • Rules receive a READ-ONLY view of state. TypeScript enforces this at
 *   compile time via `DeepReadonly`. There is no way for a rule to mutate
 *   SimulationState through this interface.
 * • The `emitRevenue` / `emitRisk` callbacks are the ONLY side-effect a rule
 *   is permitted to perform. They append to isolated arrays owned by the
 *   engine — rules cannot touch each other's output or global state.
 * • Revenue/risk IDs are assigned by the engine via monotonic counter, so
 *   calling `evaluateEvent` twice on the same event produces different IDs.
 *   Do not assume idempotent output — store results from the first call only.
 */
export {};
