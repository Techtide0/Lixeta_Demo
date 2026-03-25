/**
 * @file middleware/request-context.ts
 * @description Attaches a request ID and scoped logger to every incoming
 * request. Must run before any route handler.
 *
 * Also injects:
 *   - `res.locals.requestId`  — unique request ID string
 *   - `res.locals.log`        — scoped logger bound to this request ID
 *   - `res.locals.startTime`  — high-res start time for latency logging
 *
 * The `X-Request-Id` header is echoed back in every response so clients
 * can correlate requests with server logs.
 */

import type { Req as Request, Res as Response, NextFn as NextFunction } from "../lib/mini-router.js";
import { generateRequestId } from "../lib/request-id.js";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Locals type extension
// ---------------------------------------------------------------------------

declare module "express" {
  interface Locals {
    requestId: string;
    log: ReturnType<typeof logger.child>;
    startTime: number;
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = generateRequestId();
  const startTime = Date.now();
  const log = logger.child(requestId);

  res.locals["requestId"] = requestId;
  res.locals["log"] = log;
  res.locals["startTime"] = startTime;

  // Echo the request ID back so clients can correlate
  res.setHeader("X-Request-Id", requestId);

  // Security headers on every response
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "0"); // modern browsers don't need this; disable the broken one
  res.setHeader("Referrer-Policy", "no-referrer");

  log.info("Request received", {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });

  // Log completion
  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    log.info("Request completed", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs,
    });
  });

  next();
}
