/**
 * @file routes/session/logs.ts
 * @description GET /logs?sessionId=<id> — retrieve the full audit log for a session.
 *
 * Returns all events, revenue events, risk events, rule traces, and decisions
 * accumulated in the session — in chronological order.
 *
 * Query parameters:
 *   sessionId   (required)  The session to retrieve
 *   limit       (optional)  Max events to return (default: 100, max: 1000)
 *   offset      (optional)  Skip first N events (for pagination, default: 0)
 *   filter      (optional)  Event type filter (e.g. "message.sent")
 *
 * Security notes
 * ──────────────
 * • Session content is only accessible via an exact session ID match.
 *   There is no "list all sessions" endpoint — cross-session enumeration
 *   is impossible by design.
 * • The session ID is validated for format before any store lookup,
 *   preventing log-injection via crafted session IDs.
 * • `limit` is capped at 1000 to prevent response-size attacks.
 * • Rule traces may contain payload snapshots in development mode.
 *   In production `capturePayloadSnapshot=false` so traces are safe to return.
 */

import { createRouter } from "../../lib/mini-router.js";
import type { Req as Request, Res as Response } from "../../lib/mini-router.js";
import { sendSuccess, send400, send404, send500 } from "../../lib/response.js";
import { getSession, touchSession } from "../../store/session-store.js";
import { isValidSessionIdFormat } from "../../lib/session-id.js";
import type {
  DomainEvent,
  RevenueEvent,
  RiskEvent,
  RuleTrace,
  DecisionResult,
} from "@lixeta/models";

const router = createRouter();

// ---------------------------------------------------------------------------
// Pagination defaults
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1_000;

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

router.get("/", (req: Request, res: Response): void => {
  const requestId = (res.locals["requestId"] as string | undefined) ?? "unknown";
  const log = res.locals["log"] as import("../../lib/logger.js").RequestLogger | undefined;

  // ── Parse query parameters ────────────────────────────────────────────────

  const sessionId = req.query["sessionId"];
  const limitRaw = req.query["limit"];
  const offsetRaw = req.query["offset"];
  const filter = req.query["filter"];

  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    send400(res, "Missing required query parameter: sessionId", requestId);
    return;
  }

  if (!isValidSessionIdFormat(sessionId.trim())) {
    send400(
      res,
      "Invalid sessionId format. Session IDs start with 'sess_' followed by alphanumeric characters.",
      requestId
    );
    return;
  }

  const limit = parseIntParam(limitRaw, DEFAULT_LIMIT, 1, MAX_LIMIT);
  if (limit === null) {
    send400(res, `limit must be an integer between 1 and ${MAX_LIMIT}`, requestId);
    return;
  }

  const offset = parseIntParam(offsetRaw, 0, 0, Number.MAX_SAFE_INTEGER);
  if (offset === null) {
    send400(res, "offset must be a non-negative integer", requestId);
    return;
  }

  // ── Fetch session ─────────────────────────────────────────────────────────

  const result = getSession(sessionId.trim());

  if (!result.ok) {
    if (result.code === "SESSION_NOT_FOUND" || result.code === "SESSION_EXPIRED") {
      send404(res, requestId);
      return;
    }
    send500(res, requestId);
    return;
  }

  // Record the access (increments accessCount)
  touchSession(sessionId.trim());

  const { state, sessionId: sid, createdAt, updatedAt, expiresAt, status } = result.value;

  // ── Filter and paginate events ────────────────────────────────────────────

  let events: ReadonlyArray<DomainEvent> = state.events;
  if (typeof filter === "string" && filter.trim() !== "") {
    const f = filter.trim();
    events = events.filter((e) => e.type === f);
  }

  const totalEvents = events.length;
  const paginatedEvents = events.slice(offset, offset + limit);

  // ── Correlate revenue/risk/traces to paginated events ────────────────────

  const paginatedEventIds = new Set(paginatedEvents.map((e) => e.id));

  const revenueEvents: ReadonlyArray<RevenueEvent> = state.revenueEvents.filter(
    (r) => paginatedEventIds.has(r.triggeringEventId)
  );

  const riskEvents: ReadonlyArray<RiskEvent> = state.riskEvents.filter(
    (r) => paginatedEventIds.has(r.triggeringEventId)
  );

  const ruleTraces: ReadonlyArray<RuleTrace> = state.ruleTraces.filter(
    (t) => paginatedEventIds.has(t.triggeringEventId)
  );

  const decisions: Array<DecisionResult & { readonly eventId: string }> = [];
  for (const eventId of paginatedEventIds) {
    const decision = state.decisions[eventId];
    if (decision !== undefined) {
      decisions.push({ ...decision, eventId });
    }
  }

  log?.info("Session logs retrieved", {
    sessionId: sid,
    totalEvents,
    returnedEvents: paginatedEvents.length,
    offset,
    limit,
    filter: filter ?? null,
  });

  sendSuccess(
    res,
    {
      session: {
        sessionId: sid,
        createdAt,
        updatedAt,
        expiresAt,
        status,
        counters: state.counters,
      },
      pagination: {
        total: totalEvents,
        offset,
        limit,
        returned: paginatedEvents.length,
        hasMore: offset + paginatedEvents.length < totalEvents,
      },
      events: paginatedEvents,
      revenueEvents,
      riskEvents,
      ruleTraces,
      decisions,
    },
    requestId
  );
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function parseIntParam(
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number
): number | null {
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < min || n > max) return null;
  return n;
}

export { router as logsRouter };
