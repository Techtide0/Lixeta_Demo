/**
 * @file lib/rate-limiter.ts
 * @description In-process sliding-window rate limiter keyed by IP address.
 *
 * Uses a Map<IP, timestamp[]> with automatic GC of expired windows.
 * This is intentionally NOT Redis-backed — Stage 3 runs as a single process.
 * Stage 5+ will replace this with a distributed limiter.
 *
 * Security notes
 * ──────────────
 * • IP addresses are hashed (FNV-1a) before use as keys to avoid storing raw
 *   client IPs in memory, reducing PII exposure in heap dumps.
 * • The GC runs at most once every 30 seconds to bound CPU overhead.
 * • Max map size is capped at 50,000 entries to bound memory usage.
 *   When the cap is hit, the oldest 20% of entries are evicted.
 */
// ---------------------------------------------------------------------------
// FNV-1a IP hash (avoids storing raw IPs in memory)
// ---------------------------------------------------------------------------
function hashIP(ip) {
    let hash = 2_166_136_261;
    for (let i = 0; i < ip.length; i++) {
        hash ^= ip.charCodeAt(i);
        hash = (hash * 16_777_619) >>> 0;
    }
    return hash.toString(36);
}
// ---------------------------------------------------------------------------
// Sliding window store
// ---------------------------------------------------------------------------
const MAX_ENTRIES = 50_000;
const GC_INTERVAL_MS = 30_000;
const store = new Map();
let lastGcRun = 0;
function gc(windowMs) {
    const now = Date.now();
    if (now - lastGcRun < GC_INTERVAL_MS)
        return;
    lastGcRun = now;
    const cutoff = now - windowMs;
    for (const [key, entry] of store) {
        entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
        if (entry.timestamps.length === 0 && now - entry.lastAccess > windowMs) {
            store.delete(key);
        }
    }
    // Evict oldest 20% if still over cap
    if (store.size > MAX_ENTRIES) {
        const evictCount = Math.ceil(store.size * 0.2);
        let evicted = 0;
        for (const key of store.keys()) {
            if (evicted >= evictCount)
                break;
            store.delete(key);
            evicted++;
        }
    }
}
/**
 * Check and record a request attempt for a given IP.
 *
 * @param ip        Raw client IP address (will be hashed before storage)
 * @param max       Maximum requests allowed within the window
 * @param windowMs  Window duration in milliseconds
 */
export function checkRateLimit(ip, max, windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    gc(windowMs);
    const key = hashIP(ip);
    const entry = store.get(key) ?? { timestamps: [], lastAccess: now };
    // Slide the window
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    entry.lastAccess = now;
    if (entry.timestamps.length >= max) {
        const oldest = entry.timestamps[0] ?? now;
        const resetInMs = oldest + windowMs - now;
        store.set(key, entry);
        return { allowed: false, remaining: 0, resetInMs, limit: max };
    }
    entry.timestamps.push(now);
    store.set(key, entry);
    return {
        allowed: true,
        remaining: max - entry.timestamps.length,
        resetInMs: 0,
        limit: max,
    };
}
/** Flush all rate limit state — FOR TESTING ONLY. */
export function _flushRateLimiterForTesting() {
    if (process.env["NODE_ENV"] === "production") {
        throw new Error("_flushRateLimiterForTesting() is not allowed in production.");
    }
    store.clear();
    lastGcRun = 0;
}
