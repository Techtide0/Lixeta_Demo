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
 * • `idempotencyKey` is derived deterministically from event ID + rule ID,
 *   preventing a rule from emitting duplicate records if called twice
 *   (defensive against rule-registry bugs).
 */
export {};
