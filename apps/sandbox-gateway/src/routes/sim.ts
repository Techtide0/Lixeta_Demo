/**
 * @file routes/sim.ts
 * @description Simulation controller — drives real events through the live rules engine.
 *
 * POST /sim/start  — create a real session and begin firing event batches
 * POST /sim/stop   — halt the batch loop
 * GET  /sim/status — return current sim state (sessionId, batchCount, running)
 *
 * Each batch (every 3 s) fires 4 events through evaluateEvent() → appendEventToSession():
 *   2× message.sent   { appOpen: true }  → Smart Notification rule → ₦10 saved each
 *   1× payment.initiated                 → Diaspora Risk / Active Hours rules
 *   1× user.authenticated (cross-TZ)     → Timezone Risk rule → FLAG or DENY
 *
 * Results are immediately live on GET /analytics?sessionId=X and GET /logs?sessionId=X.
 * This is the same code path as POST /trigger-event — not a mock.
 */

import { createRouter } from "../lib/mini-router.js";
import type { Req as Request, Res as Response } from "../lib/mini-router.js";
import { evaluateEvent } from "@lixeta/rules-engine";
import {
  createEventSource,
  createDomainEvent,
  type DomainEvent,
  type EventChannel,
} from "@lixeta/models";
import { sendSuccess, send400, send409, send500 } from "../lib/response.js";
import { getEngineConfig } from "../config/engine-bootstrap.js";
import { getEnv } from "../config/env.js";
import {
  createSession,
  getSession,
  appendEventToSession,
} from "../store/session-store.js";
import { logger } from "../lib/logger.js";

const router = createRouter();

// ---------------------------------------------------------------------------
// Simulation state (module-level — lives for the server process lifetime)
// ---------------------------------------------------------------------------

interface SimState {
  running: boolean;
  sessionId: string | null;
  intervalId: ReturnType<typeof setInterval> | null;
  batchCount: number;
  startedAt: string | null;
}

const sim: SimState = {
  running:   false,
  sessionId: null,
  intervalId: null,
  batchCount: 0,
  startedAt:  null,
};

// ---------------------------------------------------------------------------
// Batch data pools
// ---------------------------------------------------------------------------

const PHONES = [
  "+2348012345678", "+2348023456789", "+2349012345678",
  "+2349023456789", "+2348034567890", "+2347012345678",
  "+2348045678901", "+2349056789012",
];

const CROSS_TZ = [
  { device: "Europe/London",       account: "Africa/Lagos", country: "GB" },
  { device: "America/New_York",    account: "Africa/Lagos", country: "US" },
  { device: "Asia/Dubai",          account: "Africa/Lagos", country: "AE" },
  { device: "America/Los_Angeles", account: "Africa/Lagos", country: "US" },
  { device: "Asia/Singapore",      account: "Africa/Lagos", country: "SG" },
];

const AMOUNTS = [150_000, 250_000, 75_000, 500_000, 100_000, 350_000];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function uid(prefix: string, batch: number, idx: number): string {
  return `${prefix}_sim_b${batch}_e${idx}_${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Core: fire one event through the real engine pipeline
// ---------------------------------------------------------------------------

function fireEvent(
  sessionId: string,
  type: string,
  payload: Record<string, unknown>,
  batch: number,
  idx: number,
): void {
  const sessionResult = getSession(sessionId);
  if (!sessionResult.ok) {
    logger.warn("[Sim] Session gone — halting", { code: sessionResult.code });
    stopSimulation();
    return;
  }

  const rec = sessionResult.value;
  const src = createEventSource({
    id:      "simulation-controller",
    name:    "Simulation Controller",
    version: "1.0.0",
    channel: "internal" as EventChannel,
  });

  let event: DomainEvent;
  try {
    event = createDomainEvent({
      id:       uid("evt", batch, idx),
      type:     type as DomainEvent["type"],
      payload,
      source:   src,
      severity: "info",
      priority: "normal",
      metadata: { createdAt: new Date().toISOString() },
    });
  } catch (err) {
    logger.warn("[Sim] createDomainEvent failed", { type, error: String(err) });
    return;
  }

  const env = getEnv();
  const baseCfg = getEngineConfig(env);
  const cfg = rec.aggressionLevel !== 50
    ? { ...baseCfg, aggressionLevel: rec.aggressionLevel }
    : baseCfg;

  try {
    const output = evaluateEvent(event, rec.state, cfg);
    appendEventToSession(sessionId, event, output);
  } catch (err) {
    logger.warn("[Sim] Engine error on event", { type, error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Batch: 3× message.sent (successes + savings) + 1× payment.succeeded + 1× user.authenticated (kill-switch)
// ---------------------------------------------------------------------------

function fireBatch(): void {
  const sid = sim.sessionId;
  if (!sid) return;
  sim.batchCount++;
  const b = sim.batchCount;
  const tz = pick(CROSS_TZ);
  const fraudAmount = pick(AMOUNTS);

  // ① SMS × 3 — Smart Notification rule → ₦100 saved each (appOpen suppresses SMS cost)
  // hour: 10 forces WAT 10:00 so wouldBeDeferred always returns false regardless of wall-clock time
  fireEvent(sid, "message.sent", {
    messageId:      uid("msg", b, 1),
    recipientPhone: pick(PHONES),
    appOpen:        true,
    hour:           10,
  }, b, 1);

  fireEvent(sid, "message.sent", {
    messageId:      uid("msg", b, 2),
    recipientPhone: pick(PHONES),
    appOpen:        true,
    hour:           10,
  }, b, 2);

  fireEvent(sid, "message.sent", {
    messageId:      uid("msg", b, 3),
    recipientPhone: pick(PHONES),
    appOpen:        true,
    hour:           10,
  }, b, 3);

  // ② Payment success — cleared (green row)
  fireEvent(sid, "payment.succeeded", {
    paymentId: uid("pay", b, 4),
    amount:    pick(AMOUNTS),
  }, b, 4);

  // ③ Payment reversal — Diaspora Risk rule counts reversals per session.
  //    Batch 1: 1st reversal → flag
  //    Batch 2: 2nd reversal → flag
  //    Batch 3+: 3rd reversal → BLOCK (kill-switch fires, auto-reversed in UI)
  //    Session rotates at batch 8 so the cycle repeats every ~24 s.
  fireEvent(sid, "payment.reversed", {
    paymentId:       uid("rev", b, 5),
    amount:          fraudAmount,
    suspectedAmount: fraudAmount,  // surfaced in UI as "fraud protected ₦X"
    reason:          "SLA breach — Kill-Switch triggered (25s threshold)",
  }, b, 5);

  // ④ Cross-timezone auth — Timezone Risk rule → FLAG when delta ≥ 4h
  fireEvent(sid, "user.authenticated", {
    userId:          uid("usr", b, 6),
    deviceCountry:   tz.country,
    accountCountry:  "NG",
    deviceTimezone:  tz.device,
    accountTimezone: tz.account,
    suspectedAmount: pick(AMOUNTS),
  }, b, 6);
}

// ---------------------------------------------------------------------------
// Session rotation — prevents velocity/diaspora rules from locking everything
// ---------------------------------------------------------------------------

const ROTATE_EVERY_BATCHES = 8; // ~24 s between rotations

function rotateSession(): void {
  const prev = sim.sessionId;
  const result = createSession({
    metadata: {
      label:       `Live Demo — Batch ${sim.batchCount + 1}`,
      environment: "demo",
      tags:        ["sim-controller", "rotated"],
    },
  });
  if (result.ok) {
    sim.sessionId = result.value.sessionId;
    logger.info("[Sim] Session rotated", { prev, next: sim.sessionId });
  }
}

// ---------------------------------------------------------------------------
// Start / stop
// ---------------------------------------------------------------------------

function startSimulation(): string | null {
  const sessionResult = createSession({
    metadata: {
      label:       "Live Demo — Simulate Traffic",
      environment: "demo",
      tags:        ["sim-controller", "live-demo"],
    },
  });

  if (!sessionResult.ok) {
    logger.error("[Sim] Failed to create session", { code: sessionResult.code });
    return null;
  }

  sim.sessionId  = sessionResult.value.sessionId;
  sim.running    = true;
  sim.batchCount = 0;
  sim.startedAt  = new Date().toISOString();

  logger.info("[Sim] Started", { sessionId: sim.sessionId });

  // Fire immediately, then repeat. Rotate session every ROTATE_EVERY_BATCHES
  // to reset velocity counters and keep verdicts interesting.
  fireBatch();
  sim.intervalId = setInterval(() => {
    if (!sim.running) { stopSimulation(); return; }
    if (sim.batchCount > 0 && sim.batchCount % ROTATE_EVERY_BATCHES === 0) {
      rotateSession();
    }
    fireBatch();
  }, 3_000);

  return sim.sessionId;
}

function stopSimulation(): void {
  if (sim.intervalId !== null) {
    clearInterval(sim.intervalId);
    sim.intervalId = null;
  }
  sim.running = false;
  logger.info("[Sim] Stopped", { sessionId: sim.sessionId, batchCount: sim.batchCount });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /sim/start
router.post("/start", (req: Request, res: Response): void => {
  const requestId = (res.locals["requestId"] as string | undefined) ?? "unknown";

  if (sim.running) {
    send409(
      res,
      `Simulation already running (session ${sim.sessionId ?? "unknown"}). POST /sim/stop first.`,
      requestId
    );
    return;
  }

  try {
    const sessionId = startSimulation();
    if (!sessionId) { send500(res, requestId); return; }

    sendSuccess(res, {
      started:   true,
      sessionId,
      batchIntervalMs: 3_000,
      eventsPerBatch:  4,
      message: "Simulation started. Poll GET /analytics?sessionId=X and GET /logs?sessionId=X for live data.",
    }, requestId);
  } catch (err) {
    logger.error("[Sim] Unexpected start error", { error: String(err) });
    send500(res, requestId);
  }
});

// POST /sim/stop
router.post("/stop", (req: Request, res: Response): void => {
  const requestId = (res.locals["requestId"] as string | undefined) ?? "unknown";

  if (!sim.running) {
    send400(res, "Simulation is not currently running.", requestId);
    return;
  }

  stopSimulation();
  sendSuccess(res, {
    stopped:    true,
    sessionId:  sim.sessionId,
    batchCount: sim.batchCount,
  }, requestId);
});

// GET /sim/status
router.get("/status", (_req: Request, res: Response): void => {
  const requestId = (res.locals["requestId"] as string | undefined) ?? "unknown";
  sendSuccess(res, {
    running:    sim.running,
    sessionId:  sim.sessionId,
    batchCount: sim.batchCount,
    startedAt:  sim.startedAt,
  }, requestId);
});

export { router as simRouter };
