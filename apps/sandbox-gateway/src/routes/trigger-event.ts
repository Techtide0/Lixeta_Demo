/**
 * @file routes/trigger-event.ts
 * @description POST /trigger-event — submit a domain event for engine evaluation.
 *
 * Stage 4 key changes from Stage 3:
 * • sessionId is now REQUIRED — loads accumulated session state instead of empty state
 * • Engine output is persisted back to the session store after evaluation
 * • Response includes sessionId + sequenceNumber for audit tracing
 */

import { createRouter } from "../lib/mini-router.js";
import type { Req as Request, Res as Response } from "../lib/mini-router.js";
import { evaluateEvent } from "@lixeta/rules-engine";
import type { EngineEvaluationOutput } from "@lixeta/rules-engine";
import { createEventSource, createDomainEvent, type DomainEvent, type EventChannel } from "@lixeta/models";
import { parseBody } from "../lib/validate.js";
import { sendSuccess, send400, send404, send409, send500 } from "../lib/response.js";
import { getEngineConfig } from "../config/engine-bootstrap.js";
import { getEnv } from "../config/env.js";
import { getSession, appendEventToSession } from "../store/session-store.js";
import { isValidSessionIdFormat } from "../lib/session-id.js";
import type { RequestLogger } from "../lib/logger.js";

const router = createRouter();

// ---------------------------------------------------------------------------
// Inline schema (avoids runtime zod dep)
// ---------------------------------------------------------------------------

const VALID_CHANNELS = new Set(["sms","whatsapp","email","push","in_app","api","internal","unknown"]);

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface TriggerBody {
  readonly sessionId: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp?: string;
  readonly correlationId?: string;
  readonly source?: { readonly id: string; readonly name: string; readonly version: string; readonly channel: string };
}

type FieldErrors = Record<string, string[]>;
type ParseOk = { readonly success: true; readonly data: TriggerBody };
type ParseFail = { readonly success: false; readonly error: { flatten(): { fieldErrors: FieldErrors; formErrors: string[] } } };
type ParseReturn = ParseOk | ParseFail;

function fail(field: string, msg: string): ParseFail {
  return { success: false, error: { flatten: () => ({ fieldErrors: { [field]: [msg] } as FieldErrors, formErrors: [] }) } };
}

const triggerEventSchema = {
  safeParse(raw: unknown): ParseReturn {
    if (!isPlain(raw)) return { success: false, error: { flatten: () => ({ fieldErrors: {}, formErrors: ["Body must be a JSON object"] }) } };
    const { sessionId, type, payload, timestamp, source, correlationId } = raw;
    if (typeof sessionId !== "string" || !sessionId.trim()) return fail("sessionId", "Required");
    if (!isValidSessionIdFormat(sessionId.trim())) return fail("sessionId", "Invalid format — must start with sess_");
    if (typeof type !== "string" || !type.trim() || type.length > 128) return fail("type", "Required non-empty string (max 128 chars)");
    if (!isPlain(payload)) return fail("payload", "Required JSON object");
    if (source !== undefined) {
      if (!isPlain(source)) return fail("source", "Must be an object");
      if (typeof source["channel"] !== "string" || !VALID_CHANNELS.has(source["channel"]))
        return fail("source.channel", `Must be one of: ${[...VALID_CHANNELS].join(", ")}`);
    }
    const data: TriggerBody = {
      sessionId: sessionId.trim(),
      type: type.trim(),
      payload: payload as Record<string, unknown>,
      ...(timestamp !== undefined && typeof timestamp === "string" ? { timestamp: timestamp as string } : {}),
      ...(source !== undefined ? { source: source as NonNullable<TriggerBody["source"]> } : {}),
      ...(correlationId !== undefined && typeof correlationId === "string" ? { correlationId: correlationId as string } : {}),
    } as TriggerBody;
    return { success: true as const, data };
  },
};

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const requestId = (res.locals["requestId"] as string | undefined) ?? "unknown";
  const log = res.locals["log"] as RequestLogger | undefined;

  // 1. Validate body
  const parsed = parseBody(triggerEventSchema, req.body);
  if (!parsed.ok) {
    send400(res, "Validation failed.", requestId, { fieldErrors: parsed.fieldErrors, formErrors: parsed.formErrors });
    return;
  }
  const body = parsed.data;

  // 2. Load session
  const sessionResult = getSession(body.sessionId);
  if (!sessionResult.ok) {
    if (sessionResult.code === "SESSION_NOT_FOUND" || sessionResult.code === "SESSION_EXPIRED") { send404(res, requestId); return; }
    if (["SESSION_COMPLETED","SESSION_PAUSED","SESSION_ERROR_STATE"].includes(sessionResult.code)) { send409(res, sessionResult.message, requestId); return; }
    send500(res, requestId); return;
  }

  const rec = sessionResult.value;
  const sequenceNumber = rec.sequenceCounter + 1;
  log?.debug("Session loaded", { sessionId: body.sessionId, eventCount: rec.state.events.length, sequenceNumber });

  // 3. Build event
  const src = body.source
    ? createEventSource({ ...body.source, channel: body.source.channel as EventChannel })
    : createEventSource({ id: "api-caller", name: "API Caller", version: "1.0.0", channel: "api" as EventChannel });

  let event: DomainEvent;
  try {
    event = createDomainEvent({
      id: `evt_${requestId}_s${sequenceNumber}`,
      type: body.type as DomainEvent["type"],
      payload: body.payload,
      source: src,
      ...(body.timestamp ? { timestamp: body.timestamp } : {}),
      severity: "info", priority: "normal",
      metadata: {
        createdAt: new Date().toISOString(),
        ...(body.correlationId ? { correlationId: body.correlationId } : {}),
      },
    });
  } catch (err) {
    send400(res, `Failed to build event: ${err instanceof Error ? err.message : String(err)}`, requestId);
    return;
  }

  // 4. Evaluate — inject per-session aggression level into config
  const env = getEnv();
  const baseCfg = getEngineConfig(env);
  const cfg = rec.aggressionLevel !== 50
    ? { ...baseCfg, aggressionLevel: rec.aggressionLevel }
    : baseCfg;
  let output: EngineEvaluationOutput;
  try {
    output = evaluateEvent(event, rec.state, cfg);
  } catch (err) {
    log?.error("Engine threw unexpectedly", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }

  // 5. Persist to session
  const appendResult = appendEventToSession(body.sessionId, event, output);
  if (!appendResult.ok) {
    if (appendResult.code === "SESSION_COMPLETED" || appendResult.code === "SESSION_ERROR_STATE") { send409(res, appendResult.message, requestId); return; }
    if (appendResult.code === "SESSION_NOT_FOUND" || appendResult.code === "SESSION_EXPIRED") { send404(res, requestId); return; }
    send500(res, requestId); return;
  }

  log?.info("Evaluation complete", {
    sessionId: body.sessionId, sequenceNumber, verdict: output.decision.verdict,
    revenueCount: output.revenueEvents.length, riskCount: output.riskEvents.length,
    executionMs: output.decision.totalExecutionTimeMs,
  });

  // 6. Respond
  sendSuccess(res, {
    sessionId: body.sessionId,
    sequenceNumber,
    decision: {
      id: output.decision.decisionId,
      verdict: output.decision.verdict,
      reason: output.decision.reason,
      confidence: output.decision.confidence,
      executionMs: output.decision.totalExecutionTimeMs,
    },
    revenueEvents: output.revenueEvents,
    riskEvents: output.riskEvents,
    ruleTraces: output.ruleTraces,
    meta: {
      traceTruncated: output.traceTruncated,
      appliedRuleCount: output.decision.appliedRuleTraces.length,
      totalSessionEvents: appendResult.value.state.counters.totalEventsProcessed,
    },
  }, requestId);
});

export { router as triggerEventRouter };
