/**
 * @file evaluate-event.ts
 * @description The engine's main entry point.
 *
 * `evaluateEvent` is a pure function:
 *   Input:  DomainEvent + SimulationState + EngineConfig
 *   Output: EngineEvaluationOutput (DecisionResult + revenue + risk + traces)
 *
 * The function NEVER mutates its inputs. All outputs are fresh immutable
 * objects. State accumulation is the responsibility of the simulation system
 * (Stage 4), not the engine.
 *
 * Pipeline (in order)
 * ───────────────────
 * 1. Input validation (basic shape check)
 * 2. Security guard (source, channel, payload size, sanitisation)
 * 3. Context construction
 * 4. Rule iteration (via harness — timeout + error isolation per rule)
 * 5. Verdict merge (highest-priority contribution wins)
 * 6. Output assembly (DecisionResult + revenue[] + risk[] + traces[])
 *
 * Security notes
 * ──────────────
 * • The engine is re-entrant and stateless between calls. No module-level
 *   mutable state is read or written during evaluation (the registry is
 *   read-only after freeze).
 * • All emitted IDs are generated deterministically — the same event through
 *   the same config produces the same output IDs, enabling idempotent replay.
 * • `performance.now()` is used for timing — it is monotonic and cannot be
 *   spoofed by changing the system clock.
 */
import type { SimulationState, DecisionResult, RevenueEvent, RiskEvent, RuleTrace } from "@lixeta/models";
import type { EngineConfig } from "./engine-config.js";
/**
 * The complete output of one `evaluateEvent` call.
 *
 * This is what the backend / simulation system receives and uses to:
 *   • Return a decision to the caller
 *   • Accumulate state (Stage 4)
 *   • Persist to the event store
 *   • Feed the analytics pipeline
 */
export interface EngineEvaluationOutput {
    readonly decision: DecisionResult;
    readonly revenueEvents: ReadonlyArray<RevenueEvent>;
    readonly riskEvents: ReadonlyArray<RiskEvent>;
    readonly ruleTraces: ReadonlyArray<RuleTrace>;
    /**
     * True if trace output was truncated due to `maxTraceRecords`.
     * The backend should log this as a warning.
     */
    readonly traceTruncated: boolean;
}
/**
 * Evaluate a single domain event through the rules engine.
 *
 * This function is synchronous and deterministic. It never throws — all
 * errors are captured and returned as an "error" verdict in the output.
 *
 * @param rawEvent  The event to evaluate (will be validated + sanitised)
 * @param state     Current simulation state (read-only view)
 * @param config    Active engine configuration
 */
export declare function evaluateEvent(rawEvent: unknown, state: Readonly<SimulationState>, config: Readonly<EngineConfig>): EngineEvaluationOutput;
