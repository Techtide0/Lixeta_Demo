/**
 * @file middleware/error-handler.ts
 * @description Express global error handler — last middleware in the chain.
 *
 * Security notes
 * ──────────────
 * • Stack traces are NEVER sent to clients — only logged server-side.
 * • Error messages are sanitised: only well-known operational errors
 *   surface a developer message; all others return a generic 500.
 * • The handler never re-throws — it always sends a response.
 *   This prevents Express from falling back to its default HTML error page.
 */
import { send500 } from "../lib/response.js";
import { logger } from "../lib/logger.js";
// ---------------------------------------------------------------------------
// Known operational errors (safe to surface message to client)
// ---------------------------------------------------------------------------
class OperationalError extends Error {
    statusCode;
    code;
    constructor(message, statusCode, code) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.name = "OperationalError";
    }
}
export { OperationalError };
// ---------------------------------------------------------------------------
// Global error handler — must have 4 params for Express to treat as error middleware
// ---------------------------------------------------------------------------
export function globalErrorHandler(err, req, res, _next // must be declared even if unused
) {
    const requestId = res.locals["requestId"] ?? "unknown";
    const log = logger.child(requestId);
    // Log the full error server-side (including stack trace) before sanitising
    if (err instanceof Error) {
        log.error("Unhandled error", {
            errorName: err.name,
            errorMessage: err.message,
            // Stack trace logged server-side only, never sent to client
            stack: process.env["NODE_ENV"] !== "production" ? err.stack : "[redacted]",
        });
    }
    else {
        log.error("Unknown error type thrown", { err: String(err) });
    }
    // Don't respond twice
    if (res.headersSent)
        return;
    send500(res, requestId);
}
// ---------------------------------------------------------------------------
// 404 handler — route not found
// ---------------------------------------------------------------------------
export function notFoundHandler(req, res) {
    const requestId = res.locals["requestId"] ?? "unknown";
    res.status(404).json({
        ok: false,
        requestId,
        timestamp: new Date().toISOString(),
        error: {
            code: "NOT_FOUND",
            message: `Route ${req.method} ${req.path} does not exist.`,
        },
    });
}
