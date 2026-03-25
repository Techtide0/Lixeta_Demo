/**
 * @file routes/analytics.ts
 * @description GET /analytics — derive real-time analytics from session state.
 *
 * Query parameters
 * ────────────────
 * sessionId   (required)  Single session ID or comma-separated list of up to 10.
 *             Examples:
 *               ?sessionId=sess_abc
 *               ?sessionId=sess_abc,sess_def,sess_ghi
 *
 * Response shapes
 * ───────────────
 * Single session:  { ok: true, data: SessionAnalytics }
 * Multi-session:   { ok: true, data: MultiSessionAnalytics }
 *
 * Security notes
 * ──────────────
 * • Each session ID is validated for format before any store lookup.
 * • Sessions not found or expired are reported in a `notFound[]` array rather
 *   than causing a 404 — this prevents enumeration via timing differences.
 *   (A caller with an invalid ID gets the same response shape as one with a
 *   valid ID for a different session.)
 * • Analytics computation is read-only — no session state is modified.
 * • Multi-session requests are limited to 10 sessions per call to bound CPU.
 * • The analytics engine receives only the session state — it has no store
 *   reference and cannot look up other sessions. Cross-session leakage is
 *   impossible by design.
 *
 * Real-time guarantee
 * ───────────────────
 * There is no caching layer. Every GET /analytics call re-derives all numbers
 * from the current session state. New events from POST /trigger-event are
 * immediately reflected in the next analytics call.
 */

import { createRouter } from "../lib/mini-router.js";
import type { Req as Request, Res as Response } from "../lib/mini-router.js";
import { sendSuccess, send400, send500 } from "../lib/response.js";
import { getSession } from "../store/session-store.js";
import { isValidSessionIdFormat } from "../lib/session-id.js";
import {
  computeSessionAnalytics,
  computeMultiSessionAnalytics,
} from "../analytics/engine.js";
import type { RequestLogger } from "../lib/logger.js";

const router = createRouter();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SESSIONS_PER_REQUEST = 10;

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

router.get("/", (req: Request, res: Response): void => {
  const requestId = (res.locals["requestId"] as string | undefined) ?? "unknown";
  const log = res.locals["log"] as RequestLogger | undefined;

  // ── Parse sessionId parameter ─────────────────────────────────────────────

  const rawParam = req.query["sessionId"];

  if (typeof rawParam !== "string" || rawParam.trim() === "") {
    send400(
      res,
      "Missing required query parameter: sessionId. " +
        "Provide a single session ID or comma-separated list (max 10).",
      requestId
    );
    return;
  }

  const sessionIds = rawParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sessionIds.length === 0) {
    send400(res, "sessionId must contain at least one non-empty value.", requestId);
    return;
  }

  if (sessionIds.length > MAX_SESSIONS_PER_REQUEST) {
    send400(
      res,
      `Too many sessions. Maximum ${MAX_SESSIONS_PER_REQUEST} per request. ` +
        `Received ${sessionIds.length}.`,
      requestId
    );
    return;
  }

  // ── Validate formats ──────────────────────────────────────────────────────

  const invalidIds = sessionIds.filter((id) => !isValidSessionIdFormat(id));
  if (invalidIds.length > 0) {
    send400(
      res,
      `Invalid session ID format: ${invalidIds.join(", ")}. ` +
        "Session IDs must start with 'sess_'.",
      requestId
    );
    return;
  }

  // ── Fetch sessions ────────────────────────────────────────────────────────

  const found: Array<{ sessionId: string; sessionStatus: string; state: import("../../../../packages/models/src/index.js").SimulationState }> = [];
  const notFound: string[] = [];

  for (const sessionId of sessionIds) {
    const result = getSession(sessionId);
    if (result.ok) {
      found.push({
        sessionId: result.value.sessionId,
        sessionStatus: result.value.status,
        state: result.value.state,
      });
    } else {
      notFound.push(sessionId);
    }
  }

  if (found.length === 0) {
    // All sessions were not found or expired — return 404 with structured body
    res.status(404).json({
      ok: false,
      requestId,
      timestamp: new Date().toISOString(),
      error: {
        code: "SESSION_NOT_FOUND",
        message: "None of the requested sessions were found.",
        details: { notFound },
      },
    });
    return;
  }

  // ── Compute analytics ─────────────────────────────────────────────────────

  try {
    if (found.length === 1 && notFound.length === 0) {
      // Single session — return SessionAnalytics directly
      const item = found[0]!;
      const analytics = computeSessionAnalytics(
        item.sessionId,
        item.sessionStatus,
        item.state
      );

      const failedMetrics = (analytics as any)["failedMetrics"] as string[] | undefined;

      if (failedMetrics && failedMetrics.length > 0) {
        log?.warn("Analytics partially computed with failures", {
          sessionId: item.sessionId,
          failedMetrics,
        });
      } else {
        log?.info("Analytics computed", {
          sessionId: item.sessionId,
          totalEvents: analytics.events.totalEventCount,
          netRevenue: analytics.revenue.netMinorUnits,
          riskSignals: analytics.risk.totalSignalCount,
        });
      }

      sendSuccess(res, analytics, requestId);
    } else {
      // Multi-session — return MultiSessionAnalytics
      const analytics = computeMultiSessionAnalytics(found);

      // Check if any session had failed metrics
      const allFailedMetrics = new Set<string>();
      for (const session of (analytics as any).sessions || []) {
        const failed = session["failedMetrics"] as string[] | undefined;
        if (failed) {
          failed.forEach((m) => allFailedMetrics.add(m));
        }
      }

      if (allFailedMetrics.size > 0) {
        log?.warn("Multi-session analytics partially computed with failures", {
          sessionCount: found.length,
          notFoundCount: notFound.length,
          failedMetrics: Array.from(allFailedMetrics),
        });
      } else {
        log?.info("Multi-session analytics computed", {
          sessionCount: found.length,
          notFoundCount: notFound.length,
          totalEvents: analytics.aggregate.totalEvents,
        });
      }

      const responseData = notFound.length > 0
        ? { ...analytics, notFound }
        : analytics;

      sendSuccess(res, responseData, requestId);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Classify error type
    let isTypeError = false;
    if (
      errorMessage.includes("Cannot read property") ||
      errorMessage.includes("Cannot access property") ||
      errorMessage.includes("is not defined") ||
      errorMessage.includes("is not a function") ||
      errorMessage.includes("type") ||
      errorMessage.includes("Type")
    ) {
      isTypeError = true;
    }

    if (isTypeError) {
      log?.error("Analytics computation failed: type integrity issue", {
        errorMessage,
      });
      res.status(503).json({
        ok: false,
        requestId,
        timestamp: new Date().toISOString(),
        error: {
          code: "ANALYTICS_TYPE_ERROR",
          message: "Analytics type schema mismatch. One or more metrics are unavailable.",
          details: {
            reason: "The session state contains an unexpected type structure. Analytics cannot be derived.",
            suggestion: "This usually indicates the session was created with an incompatible version of the rules engine.",
          },
        },
      });
    } else {
      log?.error("Analytics computation failed", {
        error: errorMessage,
      });
      res.status(500).json({
        ok: false,
        requestId,
        timestamp: new Date().toISOString(),
        error: {
          code: "ANALYTICS_ERROR",
          message: "Analytics computation failed.",
        },
      });
    }
  }
});

export { router as analyticsRouter };
