/**
 * @file routes/health.ts
 * @description Health and readiness check endpoints.
 *
 * GET /health         — liveness: is the process alive?
 * GET /health/ready   — readiness: is the engine initialised and ready?
 *
 * These endpoints are deliberately unauthenticated and unthrottled so
 * load balancers and orchestrators can poll them freely.
 *
 * Security note: no sensitive information is returned — only status strings
 * and the server timestamp. Engine config details are intentionally omitted.
 */
import { createRouter } from "../lib/mini-router.js";
import { sendSuccess } from "../lib/response.js";
const router = createRouter();
// ---------------------------------------------------------------------------
// GET /health — liveness
// ---------------------------------------------------------------------------
router.get("/", (_req, res) => {
    const requestId = res.locals["requestId"] ?? "liveness";
    sendSuccess(res, {
        status: "ok",
        service: "sandbox-gateway",
        version: "1.0.0",
        timestamp: new Date().toISOString(),
    }, requestId);
});
// ---------------------------------------------------------------------------
// GET /health/ready — readiness (engine bootstrapped?)
// ---------------------------------------------------------------------------
let _engineReady = false;
/** Called by engine-bootstrap after successful initialisation. */
export function markEngineReady() {
    _engineReady = true;
}
router.get("/ready", (_req, res) => {
    const requestId = res.locals["requestId"] ?? "readiness";
    if (!_engineReady) {
        res.status(503).json({
            ok: false,
            requestId,
            timestamp: new Date().toISOString(),
            error: {
                code: "NOT_READY",
                message: "Engine is still initialising. Retry shortly.",
            },
        });
        return;
    }
    sendSuccess(res, {
        status: "ready",
        service: "sandbox-gateway",
        engine: "rules-engine@1.0.0",
        timestamp: new Date().toISOString(),
    }, requestId);
});
export { router as healthRouter };
