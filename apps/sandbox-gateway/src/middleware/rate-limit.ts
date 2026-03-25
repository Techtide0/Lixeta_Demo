/**
 * @file middleware/rate-limit.ts
 * @description Per-IP rate limiting middleware.
 *
 * Sets standard rate-limit response headers:
 *   X-RateLimit-Limit:     total allowed requests per window
 *   X-RateLimit-Remaining: requests left in current window
 *   Retry-After:           seconds until window resets (only on 429)
 *
 * The IP is extracted in order: X-Forwarded-For (first hop) → req.ip → "unknown".
 * In production, the gateway MUST sit behind a trusted reverse proxy that sets
 * X-Forwarded-For correctly. If req.ip itself is the proxy's IP, configure
 * Express with `app.set("trust proxy", 1)`.
 */

import type { Req as Request, Res as Response, NextFn as NextFunction } from "../lib/mini-router.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { send429 } from "../lib/response.js";

function extractIP(req: Request): string {
  // X-Forwarded-For may contain a comma-separated chain; take the first
  const forwarded = req.get("x-forwarded-for");
  if (forwarded !== undefined) {
    const first = forwarded.split(",")[0];
    if (first !== undefined) return first.trim();
  }
  return req.ip ?? "unknown";
}

export function rateLimitMiddleware(
  max: number,
  windowMs: number
) {
  return function (req: Request, res: Response, next: NextFunction): void {
    const ip = extractIP(req);
    const result = checkRateLimit(ip, max, windowMs);

    res.setHeader("X-RateLimit-Limit", String(result.limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));

    if (!result.allowed) {
      const requestId = (res.locals["requestId"] as string | undefined) ?? "unknown";
      send429(res, requestId, result.resetInMs);
      return;
    }

    next();
  };
}
