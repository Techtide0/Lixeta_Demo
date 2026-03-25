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

import type {
  DomainEvent,
  SimulationState,
  RevenueEvent,
  RiskEvent,
} from "@lixeta/models";

import type { EngineConfig } from "./engine-config.js";

// ---------------------------------------------------------------------------
// Emission helpers given to each rule
// ---------------------------------------------------------------------------

export type EmitRevenueFn = (event: Omit<RevenueEvent, "id" | "recordedAt">) => void;
export type EmitRiskFn = (event: Omit<RiskEvent, "id" | "detectedAt" | "status">) => void;

// ---------------------------------------------------------------------------
// EvaluationContext
// ---------------------------------------------------------------------------

/**
 * Everything a rule needs, and nothing more.
 *
 * Rules MUST NOT import SimulationState directly — they must use this
 * context object so the engine can enforce read-only access and inject
 * test doubles cleanly.
 */
export interface EvaluationContext {
  /**
   * The sanitised, validated event being evaluated.
   * Payload has been stripped of dangerous keys if sanitization is on.
   */
  readonly event: Readonly<DomainEvent>;

  /**
   * Read-only snapshot of simulation state at the time of this call.
   * Rules may read but NEVER mutate this object.
   */
  readonly state: Readonly<SimulationState>;

  /** Active engine configuration */
  readonly config: Readonly<EngineConfig>;

  /**
   * Monotonic evaluation counter for this call.
   * Useful for ordering traces and detecting rule-count overruns.
   */
  readonly evaluationSequence: number;

  /**
   * ISO 8601 timestamp fixed at the start of the evaluation batch.
   * All rules in one evaluateEvent call share this timestamp — ensures
   * deterministic ordering in replays.
   */
  readonly batchTimestamp: string;

  /**
   * Emit a revenue impact from within a rule.
   * The engine assigns `id` and `recordedAt` — rules must not forge these.
   */
  readonly emitRevenue: EmitRevenueFn;

  /**
   * Emit a risk signal from within a rule.
   * The engine assigns `id`, `detectedAt`, and initial `status: "open"`.
   */
  readonly emitRisk: EmitRiskFn;
}


