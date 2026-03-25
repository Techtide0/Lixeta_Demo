/**
 * @file routes/session/close.ts
 * @description DELETE /session/:sessionId — explicitly close a session.
 *
 * Once closed:
 *   • No new events are accepted (POST /trigger-event returns 409)
 *   • The session remains readable via GET /logs until it expires
 *   • Status transitions to "completed"
 *
 * This is the clean-shutdown path for clients that know they're done.
 * Sessions also auto-expire after their TTL without needing this call.
 */

import { createRouter } from "../../lib/mini-router.js";
import type { Req as Request, Res as Response } from "../../lib/mini-router.js";
import { sendSuccess, send400, send404, send409, send500 } from "../../lib/response.js";
import { closeSession } from "../../store/session-store.js";
import { isValidSessionIdFormat } from "../../lib/session-id.js";

const router = createRouter();

router.post("/close", (req: Request, res: Response): void => {
  const requestId = (res.locals["requestId"] as string | undefined) ?? "unknown";
  const log = res.locals["log"] as import("../../lib/logger.js").RequestLogger | undefined;

  const body = req.body as { sessionId?: unknown } | undefined;
  const sessionId = body?.sessionId;

  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    send400(res, "Missing required field: sessionId", requestId);
    return;
  }

  if (!isValidSessionIdFormat(sessionId.trim())) {
    send400(res, "Invalid sessionId format.", requestId);
    return;
  }

  const result = closeSession(sessionId.trim());

  if (!result.ok) {
    if (result.code === "SESSION_NOT_FOUND" || result.code === "SESSION_EXPIRED") {
      send404(res, requestId);
      return;
    }
    if (result.code === "SESSION_COMPLETED") {
      send409(res, "Session is already closed.", requestId);
      return;
    }
    send500(res, requestId);
    return;
  }

  log?.info("Session closed", { sessionId: result.value.sessionId });

  sendSuccess(res, {
    sessionId: result.value.sessionId,
    status: result.value.status,
    closedAt: result.value.updatedAt,
    totalEvents: result.value.state.counters.totalEventsProcessed,
    totalDecisions: result.value.state.counters.totalDecisions,
  }, requestId);
});

export { router as closeSessionRouter };
