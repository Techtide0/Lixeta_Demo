/**
 * @file routes/session/patch-aggression.ts
 * @description PATCH /session/aggression — update engine aggression level for a session.
 *
 * Aggression level (0–100) controls how "eager" the rules engine is.
 * Lower values = conservative decisions. Higher values = more actions fired.
 * This affects active-hours windows, velocity thresholds, and risk sensitivity.
 */
import { createRouter } from "../../lib/mini-router.js";
import { sendSuccess, send400, send404, send409 } from "../../lib/response.js";
import { updateAggressionLevel } from "../../store/session-store.js";
import { isValidSessionIdFormat } from "../../lib/session-id.js";
const router = createRouter();
router.patch("/aggression", (req, res) => {
    const requestId = res.locals["requestId"] ?? "unknown";
    const body = req.body;
    if (!body || typeof body !== "object") {
        send400(res, "Body must be a JSON object with sessionId and level.", requestId);
        return;
    }
    const { sessionId, level } = body;
    if (typeof sessionId !== "string" || !sessionId.trim()) {
        send400(res, "sessionId is required.", requestId);
        return;
    }
    if (!isValidSessionIdFormat(sessionId.trim())) {
        send400(res, "Invalid sessionId format — must start with sess_.", requestId);
        return;
    }
    if (typeof level !== "number" || level < 0 || level > 100) {
        send400(res, "level must be a number between 0 and 100.", requestId);
        return;
    }
    const result = updateAggressionLevel(sessionId.trim(), level);
    if (!result.ok) {
        if (result.code === "SESSION_NOT_FOUND" || result.code === "SESSION_EXPIRED") {
            send404(res, requestId);
            return;
        }
        if (result.code === "SESSION_COMPLETED") {
            send409(res, result.message, requestId);
            return;
        }
        send400(res, result.message, requestId);
        return;
    }
    sendSuccess(res, {
        sessionId: result.value.sessionId,
        aggressionLevel: result.value.aggressionLevel,
        updatedAt: result.value.updatedAt,
    }, requestId);
});
export { router as patchAggressionRouter };
