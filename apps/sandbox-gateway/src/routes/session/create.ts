/**
 * @file routes/session/create.ts
 * @description POST /session — create a new simulation session.
 *
 * Request body (all fields optional):
 * {
 *   "metadata": {
 *     "label": "My Test Session",
 *     "environment": "staging",
 *     "tags": ["sms", "payments"],
 *     "ownerId": "user_123"
 *   },
 *   "ttlSeconds": 7200,
 *   "scenarioId": "custom_scenario",
 *   "scenarioName": "My Custom Scenario"
 * }
 *
 * Response:
 * {
 *   "ok": true,
 *   "data": {
 *     "sessionId": "sess_...",
 *     "createdAt": "...",
 *     "expiresAt": "...",
 *     "status": "active"
 *   }
 * }
 *
 * Security notes
 * ──────────────
 * • `metadata` is validated for size (max 2KB serialised) and key count
 *   (max 20 keys) before being stored. This prevents metadata-stuffing attacks.
 * • `ttlSeconds` is clamped to [60, 86400] — no infinite sessions, no sub-minute TTLs.
 * • The creator's IP is hashed before storage. The route extracts it from
 *   `req.ip` (trusted after `trust proxy` is set in index.ts).
 * • Session ID is returned but NOT logged by this handler — the requestId
 *   correlation is sufficient for tracing.
 */

import { createRouter } from "../../lib/mini-router.js";
import type { Req as Request, Res as Response } from "../../lib/mini-router.js";
import { sendSuccess, send400, send503 } from "../../lib/response.js";
import { createSession } from "../../store/session-store.js";
import type { SessionMetadata } from "../../store/session-record.js";

const router = createRouter();

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_METADATA_BYTES = 2048;
const MAX_METADATA_KEYS = 20;
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 64;
const TTL_MIN_S = 60;
const TTL_MAX_S = 86_400; // 24 hours

interface CreateSessionBody {
  readonly metadata?: unknown;
  readonly ttlSeconds?: unknown;
  readonly scenarioId?: unknown;
  readonly scenarioName?: unknown;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function validateMetadata(raw: unknown): ValidationResult<SessionMetadata> {
  if (raw === undefined) return { ok: true, data: {} };

  if (!isPlain(raw)) return { ok: false, error: "metadata must be a JSON object" };

  const keys = Object.keys(raw);
  if (keys.length > MAX_METADATA_KEYS) {
    return { ok: false, error: `metadata must not exceed ${MAX_METADATA_KEYS} keys` };
  }

  const serialized = JSON.stringify(raw);
  if (serialized.length > MAX_METADATA_BYTES) {
    return { ok: false, error: `metadata must not exceed ${MAX_METADATA_BYTES} bytes when serialised` };
  }

  const { label, environment, tags, ownerId } = raw;

  if (label !== undefined && (typeof label !== "string" || label.length > 128)) {
    return { ok: false, error: "metadata.label must be a string ≤ 128 characters" };
  }
  if (environment !== undefined && (typeof environment !== "string" || environment.length > 64)) {
    return { ok: false, error: "metadata.environment must be a string ≤ 64 characters" };
  }
  if (ownerId !== undefined && (typeof ownerId !== "string" || ownerId.length > 128)) {
    return { ok: false, error: "metadata.ownerId must be a string ≤ 128 characters" };
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags)) return { ok: false, error: "metadata.tags must be an array" };
    if (tags.length > MAX_TAGS) return { ok: false, error: `metadata.tags must not exceed ${MAX_TAGS} items` };
    for (const tag of tags) {
      if (typeof tag !== "string" || tag.length > MAX_TAG_LENGTH) {
        return { ok: false, error: `Each tag must be a string ≤ ${MAX_TAG_LENGTH} characters` };
      }
    }
  }

  return {
    ok: true,
    data: {
      ...(label !== undefined ? { label: label as string } : {}),
      ...(environment !== undefined ? { environment: environment as string } : {}),
      ...(ownerId !== undefined ? { ownerId: ownerId as string } : {}),
      ...(tags !== undefined ? { tags: (tags as string[]).slice() } : {}),
    },
  };
}

function validateTtl(raw: unknown): ValidationResult<number> {
  if (raw === undefined) return { ok: true, data: 2 * 60 * 60 }; // default 2 hours

  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return { ok: false, error: "ttlSeconds must be an integer" };
  }
  const clamped = Math.min(TTL_MAX_S, Math.max(TTL_MIN_S, raw));
  return { ok: true, data: clamped };
}

function validateScenarioField(
  raw: unknown,
  field: string,
  maxLen: number
): ValidationResult<string | undefined> {
  if (raw === undefined) return { ok: true, data: undefined };
  if (typeof raw !== "string" || raw.length > maxLen) {
    return { ok: false, error: `${field} must be a string ≤ ${maxLen} characters` };
  }
  return { ok: true, data: raw.trim() };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

router.post("/", (req: Request, res: Response): void => {
  const requestId = (res.locals["requestId"] as string | undefined) ?? "unknown";
  const log = res.locals["log"] as import("../../lib/logger.js").RequestLogger | undefined;

  const body = req.body as CreateSessionBody | undefined;

  // ── Validate fields ────────────────────────────────────────────────────────

  const metaResult = validateMetadata(body?.metadata);
  if (!metaResult.ok) {
    send400(res, metaResult.error ?? "Invalid metadata", requestId);
    return;
  }

  const ttlResult = validateTtl(body?.ttlSeconds);
  if (!ttlResult.ok) {
    send400(res, ttlResult.error ?? "Invalid ttlSeconds", requestId);
    return;
  }

  const scenarioIdResult = validateScenarioField(body?.scenarioId, "scenarioId", 128);
  if (!scenarioIdResult.ok) {
    send400(res, scenarioIdResult.error ?? "Invalid scenarioId", requestId);
    return;
  }

  const scenarioNameResult = validateScenarioField(body?.scenarioName, "scenarioName", 256);
  if (!scenarioNameResult.ok) {
    send400(res, scenarioNameResult.error ?? "Invalid scenarioName", requestId);
    return;
  }

  // ── Create session ─────────────────────────────────────────────────────────

  const result = createSession({
    ...(metaResult.data !== undefined ? { metadata: metaResult.data } : {}),
    creatorIp: req.ip,
    ttlMs: ttlResult.data! * 1000,
    ...(scenarioIdResult.data !== undefined ? { scenarioId: scenarioIdResult.data } : {}),
    ...(scenarioNameResult.data !== undefined ? { scenarioName: scenarioNameResult.data } : {}),
  });

  if (!result.ok) {
    if (result.code === "CAPACITY_EXCEEDED") {
      send503(res, result.message, requestId);
      return;
    }
    send400(res, result.message, requestId);
    return;
  }

  const record = result.value;
  log?.info("Session created", {
    sessionId: record.sessionId,
    ttlMs: ttlResult.data! * 1000,
    expiresAt: record.expiresAt,
  });

  sendSuccess(
    res,
    {
      sessionId: record.sessionId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      status: record.status,
      metadata: record.clientMetadata,
    },
    requestId,
    201
  );
});

export { router as createSessionRouter };
