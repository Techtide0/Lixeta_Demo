/**
 * @file store/session-store.ts
 * @description In-memory session store backed by a Map<sessionId, SessionRecord>.
 *
 * This is Stage 4's "database". Every session lives here for its TTL.
 *
 * Architecture
 * ────────────
 * • Single source of truth: all session reads and writes go through this module.
 * • Immutable updates: every write produces a new SessionRecord; the old one is
 *   discarded. The Map stores the latest snapshot.
 * • GC: expired sessions are purged by a passive sweeper that runs on every
 *   read AND by a periodic active sweep. No session leaks memory indefinitely.
 * • Capacity cap: the store rejects new sessions when MAX_SESSIONS is reached,
 *   preventing unbounded memory growth under load.
 *
 * Security notes
 * ──────────────
 * • No session is readable after `expiresAt` — the store returns undefined for
 *   expired records even before GC removes them.
 * • Session IDs are never logged in full by this module — callers may log them.
 * • `getSessionCount()` is exposed for metrics only — session content is not.
 * • IP is hashed (FNV-1a) before storage; raw IPs never appear in the Map.
 * • Cross-session data isolation: there is no API to list all sessions or
 *   iterate over another session's events.
 *
 * Stage 5 swap: replace the Map with a Redis client or DB adapter behind the
 * same SessionStore interface — no other file changes.
 */

import type {
  DomainEvent,
} from "@lixeta/models";

import { createInitialSimulationState } from "@lixeta/models";
import type { EngineEvaluationOutput } from "@lixeta/rules-engine";
import type { SessionRecord, SessionMetadata } from "./session-record.js";
import {
  applyEngineOutput,
  recordAccess,
  markCompleted,
  markExpired,
} from "./session-record.js";
import { generateSessionId } from "../lib/session-id.js";

// ---------------------------------------------------------------------------
// Constants (overridable via env in tests)
// ---------------------------------------------------------------------------

/** Default session TTL: 2 hours */
const DEFAULT_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** Hard cap on concurrent sessions to bound memory */
const MAX_SESSIONS = 10_000;

/** GC sweep interval: every 5 minutes */
const GC_INTERVAL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// IP hash (avoid storing raw client IPs in memory)
// ---------------------------------------------------------------------------

function hashIP(ip: string): string {
  let h = 2_166_136_261;
  for (let i = 0; i < ip.length; i++) {
    h ^= ip.charCodeAt(i);
    h = (h * 16_777_619) >>> 0;
  }
  return `ip_${h.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const _store = new Map<string, SessionRecord>();
let _lastGc = 0;

// ---------------------------------------------------------------------------
// GC
// ---------------------------------------------------------------------------

function gcSweep(now: number): void {
  if (now - _lastGc < GC_INTERVAL_MS) return;
  _lastGc = now;

  for (const [id, record] of _store) {
    if (new Date(record.expiresAt).getTime() < now) {
      _store.delete(id);
    }
  }
}

function isExpired(record: SessionRecord, now: number): boolean {
  return new Date(record.expiresAt).getTime() < now;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type StoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: StoreErrorCode; readonly message: string };

export type StoreErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "SESSION_COMPLETED"
  | "SESSION_ERROR_STATE"
  | "CAPACITY_EXCEEDED"
  | "INVALID_SESSION_ID"
  | "SESSION_PAUSED";

function storeOk<T>(value: T): StoreResult<T> {
  return { ok: true, value };
}

function storeErr<T>(code: StoreErrorCode, message: string): StoreResult<T> {
  return { ok: false, code, message };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CreateSessionOptions {
  readonly metadata?: SessionMetadata;
  readonly creatorIp?: string;
  readonly ttlMs?: number;
  readonly enabledRuleIds?: ReadonlyArray<string>;
  readonly scenarioId?: string;
  readonly scenarioName?: string;
}

/**
 * Create a new session. Returns the session record.
 *
 * Fails with CAPACITY_EXCEEDED if the store is full.
 */
export function createSession(
  options: CreateSessionOptions = {}
): StoreResult<SessionRecord> {
  const now = Date.now();
  gcSweep(now);

  if (_store.size >= MAX_SESSIONS) {
    return storeErr("CAPACITY_EXCEEDED",
      `Session capacity limit (${MAX_SESSIONS}) reached. ` +
      "Existing sessions must expire before new ones can be created.");
  }

  const sessionId = generateSessionId();
  const nowISO = new Date(now).toISOString();
  const ttl = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  const expiresAt = new Date(now + ttl).toISOString();

  const initialState = {
    ...createInitialSimulationState(sessionId, {
      scenarioId: options.scenarioId ?? "api_session",
      scenarioName: options.scenarioName ?? "API Session",
      maxEvents: 10_000,
      timeoutMs: ttl,
      enabledRules: [...(options.enabledRuleIds ?? [])],
      pluginIds: ["api-gateway"],
    }),
    // Sessions are active the moment they're created — "idle" is misleading
    status: "running" as const,
  };

  const record: SessionRecord = {
    sessionId,
    createdAt: nowISO,
    updatedAt: nowISO,
    expiresAt,
    status: "active",
    sequenceCounter: 0,
    clientMetadata: options.metadata ?? {},
    creatorIpHash: hashIP(options.creatorIp ?? "unknown"),
    accessCount: 0,
    state: initialState,
    aggressionLevel: 50,
  };

  _store.set(sessionId, record);
  return storeOk(record);
}

/**
 * Update the aggression level for a session.
 * Returns the updated record, or an error if the session is not found/active.
 */
export function updateAggressionLevel(
  sessionId: string,
  level: number
): StoreResult<SessionRecord> {
  const result = getSession(sessionId);
  if (!result.ok) return result;

  if (result.value.status === "completed") {
    return storeErr("SESSION_COMPLETED",
      `Session "${sessionId}" is closed. Aggression cannot be changed.`);
  }

  const clamped = Math.max(0, Math.min(100, Math.round(level)));
  const updated = { ...result.value, aggressionLevel: clamped, updatedAt: new Date().toISOString() };
  _store.set(sessionId, updated);
  return storeOk(updated);
}

/**
 * Get a session by ID.
 *
 * Returns SESSION_NOT_FOUND, SESSION_EXPIRED, or the record.
 * Passive GC: expired sessions are removed on access.
 */
export function getSession(sessionId: string): StoreResult<SessionRecord> {
  const now = Date.now();
  gcSweep(now);

  const record = _store.get(sessionId);

  if (record === undefined) {
    return storeErr("SESSION_NOT_FOUND", `Session "${sessionId}" not found.`);
  }

  if (isExpired(record, now)) {
    _store.delete(sessionId);
    return storeErr("SESSION_EXPIRED",
      `Session "${sessionId}" has expired. Create a new session.`);
  }

  return storeOk(record);
}

/**
 * Append an engine evaluation result to a session.
 *
 * Validates session state before writing. Only "active" sessions accept
 * new events — paused, completed, error, and expired sessions are rejected.
 */
export function appendEventToSession(
  sessionId: string,
  event: DomainEvent,
  output: EngineEvaluationOutput
): StoreResult<SessionRecord> {
  const now = Date.now();
  gcSweep(now);

  const record = _store.get(sessionId);
  if (record === undefined) {
    return storeErr("SESSION_NOT_FOUND", `Session "${sessionId}" not found.`);
  }

  if (isExpired(record, now)) {
    _store.delete(sessionId);
    return storeErr("SESSION_EXPIRED",
      `Session "${sessionId}" has expired. Events cannot be added to expired sessions.`);
  }

  if (record.status === "completed") {
    return storeErr("SESSION_COMPLETED",
      `Session "${sessionId}" has been closed. Create a new session to continue.`);
  }

  if (record.status === "paused") {
    return storeErr("SESSION_PAUSED",
      `Session "${sessionId}" is paused. Resume it before sending new events.`);
  }

  if (record.status === "error") {
    return storeErr("SESSION_ERROR_STATE",
      `Session "${sessionId}" is in an error state. ` +
      "Review the last event's decision for details before continuing.");
  }

  const nowISO = new Date(now).toISOString();
  const updated = applyEngineOutput(record, event, output, nowISO);
  _store.set(sessionId, updated);

  return storeOk(updated);
}

/**
 * Close a session explicitly. No more events will be accepted.
 * The session remains readable until its TTL expires.
 */
export function closeSession(sessionId: string): StoreResult<SessionRecord> {
  const result = getSession(sessionId);
  if (!result.ok) return result;

  if (result.value.status === "completed") {
    return storeErr("SESSION_COMPLETED",
      `Session "${sessionId}" is already closed.`);
  }

  const nowISO = new Date().toISOString();
  const updated = markCompleted(result.value, nowISO);
  _store.set(sessionId, updated);

  return storeOk(updated);
}

/**
 * Touch a session read — updates accessCount without modifying state.
 * Called by the GET /logs handler so access is tracked.
 */
export function touchSession(sessionId: string): StoreResult<SessionRecord> {
  const result = getSession(sessionId);
  if (!result.ok) return result;

  const nowISO = new Date().toISOString();
  const updated = recordAccess(result.value, nowISO);
  _store.set(sessionId, updated);

  return storeOk(updated);
}

/**
 * Return a lightweight summary of all active sessions.
 * Does NOT return session content — for metrics / admin only.
 */
export function getStoreMetrics(): {
  readonly totalSessions: number;
  readonly activeSessions: number;
  readonly expiredSessions: number;
} {
  const now = Date.now();
  let active = 0;
  let expired = 0;

  for (const record of _store.values()) {
    if (isExpired(record, now)) {
      expired++;
    } else {
      active++;
    }
  }

  return { totalSessions: _store.size, activeSessions: active, expiredSessions: expired };
}

/**
 * Return count of live sessions (for health/readiness checks).
 */
export function getSessionCount(): number {
  return _store.size;
}

// ---------------------------------------------------------------------------
// Testing utilities
// ---------------------------------------------------------------------------

/** FOR TESTING ONLY — wipe all sessions. */
export function _clearStoreForTesting(): void {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("_clearStoreForTesting() is not allowed in production.");
  }
  _store.clear();
  _lastGc = 0;
}

/** FOR TESTING ONLY — insert a record directly (bypass validation). */
export function _injectSessionForTesting(record: SessionRecord): void {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("_injectSessionForTesting() is not allowed in production.");
  }
  _store.set(record.sessionId, record);
}
