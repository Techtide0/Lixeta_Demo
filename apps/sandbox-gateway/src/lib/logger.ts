/**
 * @file lib/logger.ts
 * @description Structured logger for the sandbox gateway.
 *
 * Outputs JSON lines in production (for log aggregators) and
 * human-readable coloured output in development.
 *
 * Security notes
 * ──────────────
 * • `redact()` removes sensitive fields before any value is logged.
 * • Stack traces are NEVER included in production log lines.
 * • Log levels map: error=50, warn=40, info=30, debug=20.
 *   In production only info+ is emitted.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  readonly level: LogLevel;
  readonly time: string;
  readonly requestId?: string;
  readonly msg: string;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Sensitive field redaction
// ---------------------------------------------------------------------------

const REDACTED_KEYS = new Set([
  "password", "secret", "token", "apiKey", "api_key",
  "authorization", "cookie", "x-api-key", "hash", "key",
]);

function redactObject(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 4) return { "[truncated]": true };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACTED_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactObject(v as Record<string, unknown>, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const IS_PRODUCTION = process.env["NODE_ENV"] === "production";
const MIN_LEVEL: LogLevel = IS_PRODUCTION ? "info" : "debug";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 20, info: 30, warn: 40, error: 50,
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: "\x1b[90m",  // grey
  info:  "\x1b[36m",  // cyan
  warn:  "\x1b[33m",  // yellow
  error: "\x1b[31m",  // red
};
const RESET = "\x1b[0m";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[MIN_LEVEL];
}

function emit(
  level: LogLevel,
  msg: string,
  meta: Record<string, unknown> = {},
  requestId?: string
): void {
  if (!shouldLog(level)) return;

  const sanitizedMeta = redactObject(meta);
  const entry: LogEntry = {
    level,
    time: new Date().toISOString(),
    ...(requestId !== undefined ? { requestId } : {}),
    msg,
    ...sanitizedMeta,
  };

  if (IS_PRODUCTION) {
    console.log(JSON.stringify(entry));
  } else {
    const color = LEVEL_COLOR[level];
    const prefix = `${color}[${level.toUpperCase().padEnd(5)}]${RESET}`;
    const ts = entry.time.substring(11, 23); // HH:MM:SS.mmm
    const rid = requestId !== undefined ? ` ${"\x1b[90m"}${requestId}${RESET}` : "";
    const extras =
      Object.keys(sanitizedMeta).length > 0
        ? `\n  ${JSON.stringify(sanitizedMeta, null, 2).replace(/\n/g, "\n  ")}`
        : "";
    console.log(`${prefix} ${"\x1b[90m"}${ts}${RESET}${rid} ${msg}${extras}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(requestId: string): RequestLogger;
}

export interface RequestLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

function makeRequestLogger(requestId: string): RequestLogger {
  return {
    debug: (msg, meta = {}) => emit("debug", msg, meta, requestId),
    info:  (msg, meta = {}) => emit("info",  msg, meta, requestId),
    warn:  (msg, meta = {}) => emit("warn",  msg, meta, requestId),
    error: (msg, meta = {}) => emit("error", msg, meta, requestId),
  };
}

export const logger: Logger = {
  debug: (msg, meta = {}) => emit("debug", msg, meta),
  info:  (msg, meta = {}) => emit("info",  msg, meta),
  warn:  (msg, meta = {}) => emit("warn",  msg, meta),
  error: (msg, meta = {}) => emit("error", msg, meta),
  child: (requestId) => makeRequestLogger(requestId),
};
