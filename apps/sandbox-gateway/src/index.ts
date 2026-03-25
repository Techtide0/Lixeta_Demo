/**
 * @file index.ts
 * @description Sandbox Gateway — server entry point (Stage 5).
 *
 * New routes added in Stage 5:
 *   GET  /analytics        — single/multi-session analytics (Revenue, Risk, Rules, Events)
 *
 * New routes added in Stage 4:
 *   POST /session          — create a new simulation session
 *   POST /session/close    — explicitly close a session
 *   GET  /logs             — retrieve full session history
 *
 * Stage 3 routes unchanged:
 *   GET  /health           — liveness check
 *   GET  /health/ready     — readiness check
 *   POST /trigger-event    — submit event (now session-aware)
 */

import { config as loadDotenv } from "dotenv";
loadDotenv();

import { getEnv } from "./config/env.js";
import { getEngineConfig } from "./config/engine-bootstrap.js";
import { createApp, cors } from "./lib/mini-router.js";
import { requestContextMiddleware } from "./middleware/request-context.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import { authMiddleware } from "./middleware/auth.js";
import { globalErrorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { healthRouter, markEngineReady } from "./routes/health.js";
import { triggerEventRouter } from "./routes/trigger-event.js";
import { createSessionRouter } from "./routes/session/create.js";
import { closeSessionRouter } from "./routes/session/close.js";
import { logsRouter } from "./routes/session/logs.js";
import { patchAggressionRouter } from "./routes/session/patch-aggression.js";
import { analyticsRouter } from "./routes/analytics.js";
import { isoRouter } from "./routes/iso.js";
import { disputeRouter } from "./routes/dispute.js";
import { docsRouter } from "./routes/docs.js";
import { logger } from "./lib/logger.js";

async function bootstrap(): Promise<void> {
  let env;
  try {
    env = getEnv();
  } catch (err) {
    logger.error("Fatal: environment configuration invalid", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }

  logger.info("Environment loaded", { nodeEnv: env.NODE_ENV, port: env.PORT, authRequired: env.REQUIRE_AUTH });

  try {
    getEngineConfig(env);
    markEngineReady();
    logger.info("Rules engine ready");
  } catch (err) {
    logger.error("Fatal: rules engine failed to initialise", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }

  const app = createApp();
  app.disable("x-powered-by");

  // CORS
  app.use(cors({
    origin: env.ALLOWED_ORIGINS.length > 0 ? env.ALLOWED_ORIGINS.slice() : false,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Api-Key", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "X-RateLimit-Limit", "X-RateLimit-Remaining"],
    maxAge: 86_400,
  }));

  // Request context (requestId, security headers, logger)
  app.use(requestContextMiddleware);

  const limiter = rateLimitMiddleware(env.RATE_LIMIT_MAX, env.RATE_LIMIT_WINDOW_MS);
  const auth = authMiddleware(env.API_KEY_HASH, env.REQUIRE_AUTH);

  // ── Routes ──────────────────────────────────────────────────────────────

  // Docs + OpenAPI spec — no auth, no rate limit
  app.use(docsRouter);

  // Health — no auth, no rate limit
  app.use("/health", healthRouter);

  // Session management — rate limited + auth
  app.use("/session", limiter);
  app.use("/session", auth);
  app.use("/session", createSessionRouter);
  app.use("/session", closeSessionRouter);
  app.use("/session", patchAggressionRouter);

  // Logs — rate limited + auth
  app.use("/logs", limiter);
  app.use("/logs", auth);
  app.use("/logs", logsRouter);

  // Trigger event — rate limited + auth
  app.use("/trigger-event", limiter);
  app.use("/trigger-event", auth);
  app.use("/trigger-event", triggerEventRouter);

  // Analytics — rate limited + auth
  app.use("/analytics", limiter);
  app.use("/analytics", auth);
  app.use("/analytics", analyticsRouter);

  // ISO builder — rate limited + auth
  app.use("/iso", limiter);
  app.use("/iso", auth);
  app.use("/iso", isoRouter);

  // Dispute evidence — rate limited + auth
  app.use("/dispute", limiter);
  app.use("/dispute", auth);
  app.use("/dispute", disputeRouter);

  // Error handling
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  app.listen(env.PORT, () => {
    logger.info("Sandbox Gateway listening", {
      port: env.PORT, nodeEnv: env.NODE_ENV,
      routes: [
        "GET  /health", "GET  /health/ready",
        "POST /session", "POST /session/close",
        "PATCH /session/aggression",
        "GET  /logs",
        "POST /trigger-event",
        "GET  /analytics",
        "GET  /iso/pacs008",
        "POST /dispute",
        "GET  /docs", "GET  /openapi.yaml",
      ],
    });
  });
}

bootstrap().catch((err) => {
  logger.error("Unhandled bootstrap error", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
