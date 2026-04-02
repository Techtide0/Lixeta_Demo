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
 * • Emitted IDs include a monotonic counter and are NOT idempotent across
 *   calls — the same event produces different IDs on repeated evaluation.
 *   IDs are unique within a process lifetime; treat them as opaque audit keys.
 * • `performance.now()` is used for timing — it is monotonic and cannot be
 *   spoofed by changing the system clock.
 */
import { assertDomainEvent } from "@lixeta/models";
import { runSecurityGuard } from "../security/security-guard.js";
import { getEnabledRules } from "../registry/rule-registry.js";
import { invokeRule } from "./rule-harness.js";
import { mergeVerdicts } from "./rule.js";
import { generateDecisionId, generateRevenueEventId, generateRiskEventId, } from "../utils/id-generator.js";
// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------
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
export function evaluateEvent(rawEvent, state, config) {
    const startTime = performance.now();
    const batchTimestamp = new Date().toISOString();
    const decisionId = generateDecisionId((rawEvent !== null && typeof rawEvent === "object" && typeof rawEvent.id === "string")
        ? rawEvent.id
        : "unknown");
    const meta = { startTime, batchTimestamp, decisionId };
    // ── Step 1: validate event shape ──────────────────────────────────────
    let validatedEvent;
    try {
        assertDomainEvent(rawEvent);
        validatedEvent = rawEvent;
    }
    catch (err) {
        return buildValidationErrorOutput(rawEvent, meta, err);
    }
    // ── Step 2: security guard ────────────────────────────────────────────
    const guardResult = runSecurityGuard(validatedEvent, config);
    if (guardResult.passed === false) {
        return buildSecurityRejectionOutput(validatedEvent, meta, guardResult.reason, guardResult.code);
    }
    const event = guardResult.sanitizedEvent;
    // ── Step 3: collect enabled rules ─────────────────────────────────────
    const rules = getEnabledRules(config.enabledRuleIds);
    if (rules.length > config.limits.maxRulesPerEvaluation) {
        return buildLimitExceededOutput(event, meta, `Rule count ${rules.length} exceeds maxRulesPerEvaluation limit of ${config.limits.maxRulesPerEvaluation}`);
    }
    // ── Step 4: build emission buffers ────────────────────────────────────
    const revenueBuffer = [];
    const riskBuffer = [];
    const traceBuffer = [];
    const verdictContributions = [];
    let evaluationSequence = 0;
    const emitRevenue = (partial) => {
        const id = generateRevenueEventId(partial.triggeringEventId, partial.triggeringRuleId ?? "engine");
        const record = {
            id,
            recordedAt: batchTimestamp,
            ...partial,
        };
        revenueBuffer.push(record);
    };
    const emitRisk = (partial) => {
        const id = generateRiskEventId(partial.triggeringEventId, partial.triggeringRuleId ?? "engine");
        const record = {
            id,
            detectedAt: batchTimestamp,
            status: "open",
            ...partial,
        };
        riskBuffer.push(record);
    };
    // ── Step 5: run rules ─────────────────────────────────────────────────
    for (const rule of rules) {
        const elapsedMs = performance.now() - startTime;
        const budgetRemaining = config.limits.maxTotalExecutionMs - elapsedMs;
        const ctx = {
            event,
            state,
            config,
            evaluationSequence: ++evaluationSequence,
            batchTimestamp,
            emitRevenue,
            emitRisk,
        };
        const harnessResult = invokeRule(rule, ctx, evaluationSequence - 1, budgetRemaining);
        switch (harnessResult.kind) {
            case "evaluated": {
                // Patch the measured execution time from the harness into the trace.
                // Rules set executionTimeMs: 0 as a placeholder; the harness is the
                // only place that can measure actual wall-clock time post-evaluation.
                const patchedTrace = {
                    ...harnessResult.result.trace,
                    executionTimeMs: Math.round(harnessResult.executionMs * 100) / 100,
                };
                traceBuffer.push(patchedTrace);
                verdictContributions.push(harnessResult.result.verdictContribution);
                break;
            }
            case "skipped": {
                traceBuffer.push(harnessResult.trace);
                // skipped rules don't contribute a verdict
                break;
            }
            case "error": {
                traceBuffer.push(harnessResult.trace);
                // error rules contribute a "flag" to ensure visibility
                verdictContributions.push({ type: "flag", reason: `Rule ${rule.id} threw an error` });
                break;
            }
            case "budget_exceeded": {
                traceBuffer.push(harnessResult.trace);
                // stop processing remaining rules
                break;
            }
        }
        if (harnessResult.kind === "budget_exceeded")
            break;
    }
    // ── Step 6: merge verdicts ────────────────────────────────────────────
    const winningContribution = mergeVerdicts(verdictContributions);
    const totalExecutionMs = performance.now() - startTime;
    // ── Step 7: assemble output ───────────────────────────────────────────
    const { truncatedTraces, truncated } = applyTraceLimit(traceBuffer, config.security.maxTraceRecords);
    const decision = buildDecisionResult(event, meta, winningContribution, truncatedTraces, revenueBuffer, riskBuffer, totalExecutionMs);
    return {
        decision,
        revenueEvents: revenueBuffer,
        riskEvents: riskBuffer,
        ruleTraces: truncatedTraces,
        traceTruncated: truncated,
    };
}
// ---------------------------------------------------------------------------
// Output assemblers
// ---------------------------------------------------------------------------
function buildDecisionResult(event, meta, contribution, traces, revenueEvents, riskEvents, totalExecutionMs) {
    const traceSummaries = traces.map((t) => ({
        traceId: t.traceId,
        ruleId: t.ruleId,
        ruleName: t.ruleName,
        triggeringEventType: t.triggeringEventType,
        evaluatedAt: t.evaluatedAt,
        executionTimeMs: t.executionTimeMs,
        outcome: t.outcome,
        explanation: t.explanation,
    }));
    const appliedActions = traces.flatMap((t) => t.actions
        .filter((a) => a.executed)
        .map((a) => ({
        actionId: `${t.traceId}_${a.actionType}`,
        actionType: a.actionType,
        description: a.description,
        appliedByRuleId: t.ruleId,
        appliedByRuleName: t.ruleName,
        appliedAt: meta.batchTimestamp,
        parameters: a.result ?? {},
        succeeded: a.executed && a.errorMessage === undefined,
        ...(a.errorMessage !== undefined ? { errorMessage: a.errorMessage } : {}),
    })));
    const { verdict, reason } = contributionToVerdict(contribution);
    const base = {
        decisionId: meta.decisionId,
        sourceEventId: event.id,
        sourceEventType: event.type,
        decidedAt: meta.batchTimestamp,
        totalExecutionTimeMs: Math.round(totalExecutionMs * 100) / 100,
        verdict,
        reason,
        confidence: computeConfidence(traces),
        appliedRuleTraces: traceSummaries,
        appliedActions,
    };
    if (contribution.type === "transform" &&
        contribution.payload !== undefined) {
        return { ...base, transformedPayload: contribution.payload };
    }
    if (contribution.type === "defer" && contribution.until !== undefined) {
        return { ...base, deferUntil: contribution.until };
    }
    return base;
}
function contributionToVerdict(contribution) {
    switch (contribution.type) {
        case "block":
            return { verdict: "block", reason: contribution.reason };
        case "flag":
            return { verdict: "flag", reason: contribution.reason };
        case "transform":
            return { verdict: "transform", reason: "Payload transformed by rule" };
        case "defer":
            return { verdict: "defer", reason: contribution.reason ?? "Message scheduled for next active delivery window." };
        case "allow":
            return { verdict: "allow", reason: contribution.reason ?? "Event cleared by rules engine" };
        case "no_opinion":
            return { verdict: "allow", reason: "Event cleared by rules engine" };
    }
}
function computeConfidence(traces) {
    if (traces.length === 0)
        return 1.0;
    const errorCount = traces.filter((t) => t.outcome === "error").length;
    if (errorCount > 0)
        return Math.max(0.1, 1.0 - errorCount * 0.2);
    const firedCount = traces.filter((t) => t.outcome === "fired").length;
    return firedCount > 0 ? 1.0 : 0.9;
}
function applyTraceLimit(traces, limit) {
    if (traces.length <= limit) {
        return { truncatedTraces: traces, truncated: false };
    }
    return { truncatedTraces: traces.slice(0, limit), truncated: true };
}
// ---------------------------------------------------------------------------
// Error output builders
// ---------------------------------------------------------------------------
function buildValidationErrorOutput(rawEvent, meta, err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const eventId = (rawEvent !== null && typeof rawEvent === "object" && typeof rawEvent.id === "string")
        ? rawEvent.id
        : "unknown";
    const decision = {
        decisionId: meta.decisionId,
        sourceEventId: eventId,
        sourceEventType: "rule.error",
        decidedAt: meta.batchTimestamp,
        totalExecutionTimeMs: 0,
        verdict: "error",
        reason: `Event failed validation: ${errorMsg}`,
        confidence: 0,
        appliedRuleTraces: [],
        appliedActions: [],
        engineError: {
            message: errorMsg,
            code: "INVALID_EVENT_SHAPE",
            recoverable: false,
        },
    };
    return { decision, revenueEvents: [], riskEvents: [], ruleTraces: [], traceTruncated: false };
}
function buildSecurityRejectionOutput(event, meta, reason, code) {
    const decision = {
        decisionId: meta.decisionId,
        sourceEventId: event.id,
        sourceEventType: event.type,
        decidedAt: meta.batchTimestamp,
        totalExecutionTimeMs: 0,
        verdict: "block",
        reason: `Security guard rejected event: ${reason}`,
        confidence: 1.0,
        appliedRuleTraces: [],
        appliedActions: [],
        engineError: {
            message: reason,
            code,
            recoverable: false,
        },
    };
    return { decision, revenueEvents: [], riskEvents: [], ruleTraces: [], traceTruncated: false };
}
function buildLimitExceededOutput(event, meta, reason) {
    const decision = {
        decisionId: meta.decisionId,
        sourceEventId: event.id,
        sourceEventType: event.type,
        decidedAt: meta.batchTimestamp,
        totalExecutionTimeMs: 0,
        verdict: "error",
        reason,
        confidence: 0,
        appliedRuleTraces: [],
        appliedActions: [],
        engineError: {
            message: reason,
            code: "RULE_LIMIT_EXCEEDED",
            recoverable: false,
        },
    };
    return { decision, revenueEvents: [], riskEvents: [], ruleTraces: [], traceTruncated: false };
}
