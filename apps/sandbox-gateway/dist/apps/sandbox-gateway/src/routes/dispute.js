/**
 * @file routes/dispute.ts
 * @description POST /dispute — generate a tamper-evident evidence package for a past decision.
 *
 * Given a sessionId + eventId, this endpoint:
 *   1. Retrieves the stored event, decision, rule traces, revenue and risk events
 *   2. Builds four evidence files (rule-trace.json, api-trace.json, handshake.json, hash.txt)
 *   3. Hashes every file with SHA-256 to produce a tamper-evident seal
 *   4. Returns a downloadable dispute_<eventId>.zip attachment
 *
 * The ZIP is deterministic: same session state → same file contents → same hashes.
 * Replaying api-trace.json through POST /trigger-event must produce an identical decision.
 *
 * Security notes
 * ──────────────
 * • API keys are NEVER included — only a fingerprint (first 8 chars of SHA-256 of sourceId).
 * • The session store is read-only here; no state is mutated.
 * • rate-limited + auth-gated in index.ts (same as every protected route).
 */
import { createHash } from "crypto";
import JSZip from "jszip";
import { createRouter } from "../lib/mini-router.js";
import { send400, send404, send500 } from "../lib/response.js";
import { getSession } from "../store/session-store.js";
import { isValidSessionIdFormat } from "../lib/session-id.js";
import { getEngineConfig } from "../config/engine-bootstrap.js";
import { getEnv } from "../config/env.js";
const router = createRouter();
// ---------------------------------------------------------------------------
// SHA-256 helpers
// ---------------------------------------------------------------------------
function sha256(input) {
    return createHash("sha256").update(input).digest("hex");
}
function fingerprint(value) {
    return `sha256:${sha256(value).slice(0, 16)}…`;
}
function buildRuleTrace(decision, traces, revenueEvents, riskEvents, aggressionLevel) {
    return {
        decisionId: decision.decisionId,
        eventId: decision.sourceEventId,
        eventType: decision.sourceEventType,
        decidedAt: decision.decidedAt,
        verdict: decision.verdict,
        reason: decision.reason,
        confidence: decision.confidence,
        totalExecutionTimeMs: decision.totalExecutionTimeMs,
        aggressionLevel,
        rules: traces.map((t) => ({
            ruleId: t.ruleId,
            ruleName: t.ruleName,
            ruleVersion: t.ruleVersion,
            outcome: t.outcome,
            explanation: t.explanation,
            executionTimeMs: t.executionTimeMs,
            conditionsPassed: t.conditions.filter((c) => c.passed).length,
            conditionsFailed: t.conditions.filter((c) => !c.passed).length,
            actionsExecuted: t.actions
                .filter((a) => a.executed)
                .map((a) => a.actionType),
        })),
        revenueImpact: revenueEvents.map((r) => ({
            category: r.category,
            direction: r.direction,
            amountMinorUnits: r.amount.amountMinorUnits,
            currency: r.amount.currency,
            description: r.description,
        })),
        riskSignals: riskEvents.map((r) => ({
            category: r.category,
            severity: r.severity,
            score: r.score,
            description: r.description,
        })),
    };
}
function buildApiTrace(sessionId, event, decision, sequenceNumber) {
    return {
        schema: "lixeta/api-trace/v1",
        sessionId,
        sequenceNumber,
        requestId: `replay_${decision.decisionId}`,
        receivedAt: decision.decidedAt,
        request: {
            method: "POST",
            path: "/trigger-event",
            source: {
                id: event.source.id,
                name: event.source.name,
                version: event.source.version,
                channel: event.source.channel,
            },
            event: {
                id: event.id,
                type: event.type,
                timestamp: event.timestamp,
                payload: event.payload,
            },
        },
        response: {
            verdict: decision.verdict,
            decisionId: decision.decisionId,
            reason: decision.reason,
            confidence: decision.confidence,
            executionMs: decision.totalExecutionTimeMs,
        },
        replayInstructions: "To reproduce this decision: POST /trigger-event with body " +
            '{ "sessionId": "<new-session>", "type": "<request.event.type>", ' +
            '"payload": <request.event.payload>, "timestamp": "<request.event.timestamp>", ' +
            '"source": <request.source> }. ' +
            "The engine is deterministic — same input + same aggressionLevel → same verdict.",
    };
}
function buildHandshake(sessionId, sessionCreatedAt, aggressionLevel, enabledRules, event, nodeEnv) {
    return {
        schema: "lixeta/handshake/v1",
        generatedAt: new Date().toISOString(),
        system: {
            name: "lixeta-sandbox-gateway",
            version: "1.0.0",
            engineVersion: "1.0.0",
            environment: nodeEnv,
        },
        session: {
            sessionId,
            aggressionLevel,
            enabledRules,
            createdAt: sessionCreatedAt,
        },
        source: {
            id: event.source.id,
            idFingerprint: fingerprint(event.source.id),
            channel: event.source.channel,
        },
        integrity: {
            description: "hash.txt contains SHA-256 of each evidence file and a combined manifest hash. " +
                "Recompute to verify no file has been tampered with.",
            algorithm: "SHA-256",
            scope: "rule-trace.json + api-trace.json + handshake.json (in alphabetical order)",
        },
    };
}
// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------
router.post("/", async (req, res) => {
    const requestId = res.locals["requestId"] ?? "unknown";
    // ── 1. Parse + validate body ─────────────────────────────────────────────
    const body = req.body;
    if (!body || typeof body !== "object") {
        send400(res, "Body must be a JSON object.", requestId);
        return;
    }
    const { sessionId, eventId } = body;
    if (typeof sessionId !== "string" || !sessionId.trim()) {
        send400(res, "sessionId is required.", requestId);
        return;
    }
    if (!isValidSessionIdFormat(sessionId.trim())) {
        send400(res, "Invalid sessionId format — must start with sess_.", requestId);
        return;
    }
    if (typeof eventId !== "string" || !eventId.trim()) {
        send400(res, "eventId is required.", requestId);
        return;
    }
    const sid = sessionId.trim();
    const eid = eventId.trim();
    // ── 2. Load session ───────────────────────────────────────────────────────
    const sessionResult = getSession(sid);
    if (!sessionResult.ok) {
        send404(res, requestId);
        return;
    }
    const { state, aggressionLevel, createdAt: sessionCreatedAt } = sessionResult.value;
    // ── 3. Locate event + decision ────────────────────────────────────────────
    const event = state.events.find((e) => e.id === eid);
    if (!event) {
        send404(res, requestId);
        return;
    }
    const decision = state.decisions[eid];
    if (!decision) {
        send404(res, requestId);
        return;
    }
    const sequenceNumber = state.events.indexOf(event) + 1;
    // ── 4. Collect correlated records ─────────────────────────────────────────
    const traces = state.ruleTraces.filter((t) => t.triggeringEventId === eid);
    const revenueEvents = state.revenueEvents.filter((r) => r.triggeringEventId === eid);
    const riskEvents = state.riskEvents.filter((r) => r.triggeringEventId === eid);
    // ── 5. Build evidence documents ───────────────────────────────────────────
    const env = getEnv();
    const cfg = getEngineConfig(env);
    const ruleTraceDoc = buildRuleTrace(decision, traces, revenueEvents, riskEvents, aggressionLevel);
    const apiTraceDoc = buildApiTrace(sid, event, decision, sequenceNumber);
    const handshakeDoc = buildHandshake(sid, sessionCreatedAt, aggressionLevel, cfg.enabledRuleIds, event, env.NODE_ENV);
    // ── 6. Serialise to JSON (pretty, sorted keys for determinism) ────────────
    const ruleTraceJson = JSON.stringify(ruleTraceDoc, null, 2);
    const apiTraceJson = JSON.stringify(apiTraceDoc, null, 2);
    const handshakeJson = JSON.stringify(handshakeDoc, null, 2);
    // ── 7. Compute per-file SHA-256 hashes ────────────────────────────────────
    // Files hashed in alphabetical order for determinism.
    const hashApiTrace = sha256(apiTraceJson);
    const hashHandshake = sha256(handshakeJson);
    const hashRuleTrace = sha256(ruleTraceJson);
    // Combined manifest hash = SHA-256 of the three hashes concatenated
    const combinedHash = sha256(`${hashApiTrace}${hashHandshake}${hashRuleTrace}`);
    const hashTxt = [
        `# Lixeta Dispute Evidence Package`,
        `# Decision: ${decision.decisionId}`,
        `# Event:    ${eid}`,
        `# Session:  ${sid}`,
        `# Generated: ${new Date().toISOString()}`,
        `#`,
        `# Algorithm: SHA-256`,
        `# Format: <hash>  <filename>`,
        ``,
        `${hashApiTrace}  api-trace.json`,
        `${hashHandshake}  handshake.json`,
        `${hashRuleTrace}  rule-trace.json`,
        ``,
        `# Combined manifest hash (SHA-256 of the three hashes above in alphabetical order):`,
        `${combinedHash}  MANIFEST`,
        ``,
        `# Verification: recompute SHA-256 of each file and compare.`,
        `# Any mismatch indicates tampering.`,
    ].join("\n");
    // ── 8. Build ZIP in memory ────────────────────────────────────────────────
    let zipBuffer;
    try {
        const zip = new JSZip();
        zip.file("rule-trace.json", ruleTraceJson);
        zip.file("api-trace.json", apiTraceJson);
        zip.file("handshake.json", handshakeJson);
        zip.file("hash.txt", hashTxt);
        const zipUint8 = await zip.generateAsync({
            type: "uint8array",
            compression: "DEFLATE",
            compressionOptions: { level: 6 },
            comment: `Lixeta dispute evidence — decisionId=${decision.decisionId}`,
        });
        zipBuffer = Buffer.from(zipUint8);
    }
    catch {
        send500(res, requestId);
        return;
    }
    // ── 9. Return ZIP as attachment ───────────────────────────────────────────
    const safeId = eid.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
    const filename = `dispute_${safeId}.zip`;
    res.status(200).sendBuffer(zipBuffer, "application/zip", filename);
});
export { router as disputeRouter };
