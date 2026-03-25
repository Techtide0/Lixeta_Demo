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
// ---------------------------------------------------------------------------
// Sensitive field redaction
// ---------------------------------------------------------------------------
const REDACTED_KEYS = new Set([
    "password", "secret", "token", "apiKey", "api_key",
    "authorization", "cookie", "x-api-key", "hash", "key",
]);
function redactObject(obj, depth = 0) {
    if (depth > 4)
        return { "[truncated]": true };
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (REDACTED_KEYS.has(k.toLowerCase())) {
            out[k] = "[REDACTED]";
        }
        else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
            out[k] = redactObject(v, depth + 1);
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const IS_PRODUCTION = process.env["NODE_ENV"] === "production";
const MIN_LEVEL = IS_PRODUCTION ? "info" : "debug";
const LEVEL_RANK = {
    debug: 20, info: 30, warn: 40, error: 50,
};
const LEVEL_COLOR = {
    debug: "\x1b[90m", // grey
    info: "\x1b[36m", // cyan
    warn: "\x1b[33m", // yellow
    error: "\x1b[31m", // red
};
const RESET = "\x1b[0m";
function shouldLog(level) {
    return LEVEL_RANK[level] >= LEVEL_RANK[MIN_LEVEL];
}
function emit(level, msg, meta = {}, requestId) {
    if (!shouldLog(level))
        return;
    const sanitizedMeta = redactObject(meta);
    const entry = {
        level,
        time: new Date().toISOString(),
        ...(requestId !== undefined ? { requestId } : {}),
        msg,
        ...sanitizedMeta,
    };
    if (IS_PRODUCTION) {
        console.log(JSON.stringify(entry));
    }
    else {
        const color = LEVEL_COLOR[level];
        const prefix = `${color}[${level.toUpperCase().padEnd(5)}]${RESET}`;
        const ts = entry.time.substring(11, 23); // HH:MM:SS.mmm
        const rid = requestId !== undefined ? ` ${"\x1b[90m"}${requestId}${RESET}` : "";
        const extras = Object.keys(sanitizedMeta).length > 0
            ? `\n  ${JSON.stringify(sanitizedMeta, null, 2).replace(/\n/g, "\n  ")}`
            : "";
        console.log(`${prefix} ${"\x1b[90m"}${ts}${RESET}${rid} ${msg}${extras}`);
    }
}
function makeRequestLogger(requestId) {
    return {
        debug: (msg, meta = {}) => emit("debug", msg, meta, requestId),
        info: (msg, meta = {}) => emit("info", msg, meta, requestId),
        warn: (msg, meta = {}) => emit("warn", msg, meta, requestId),
        error: (msg, meta = {}) => emit("error", msg, meta, requestId),
    };
}
export const logger = {
    debug: (msg, meta = {}) => emit("debug", msg, meta),
    info: (msg, meta = {}) => emit("info", msg, meta),
    warn: (msg, meta = {}) => emit("warn", msg, meta),
    error: (msg, meta = {}) => emit("error", msg, meta),
    child: (requestId) => makeRequestLogger(requestId),
};
