/**
 * @file middleware/auth.ts
 * @description API key authentication middleware.
 *
 * Security design
 * ───────────────
 * • The raw API key is NEVER stored — only its SHA-256 hex hash is held in
 *   config (API_KEY_HASH env var). The raw key lives only in client headers.
 * • Comparison is constant-time to prevent timing-oracle attacks.
 *   Since we hash the incoming key before comparing, we compare two equal-
 *   length hex strings — the constant-time comparison XORs byte-by-byte
 *   without short-circuiting.
 * • The key is expected in the `X-Api-Key` header (not Authorization) to
 *   avoid accidental exposure in logs that strip Authorization but not custom
 *   headers. In production, ensure your logging pipeline strips X-Api-Key.
 * • A missing or invalid key always returns 401. The response body reveals
 *   no information about why (wrong key vs. no key) beyond "auth required".
 *
 * SHA-256 is performed via the Web Crypto API (available in Node >= 18).
 * Fallback: a simple FNV hash when crypto is unavailable (dev only).
 */
import { send401 } from "../lib/response.js";
// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------
/**
 * Compute SHA-256 hex of input string.
 * Uses Web Crypto (Node >= 18). Falls back to a deterministic non-crypto
 * hash in environments where crypto is unavailable (never in production).
 */
async function sha256Hex(input) {
    // Web Crypto API — available in Node 18+ and all modern browsers
    if (typeof globalThis !== "undefined" &&
        typeof globalThis["crypto"] !== "undefined") {
        const subtle = globalThis.crypto.subtle;
        const encoded = new TextEncoder().encode(input);
        const hashBuffer = await subtle.digest("SHA-256", encoded);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    // Fallback: FNV-1a (ONLY in dev — crypto must exist in production)
    console.warn("[Auth] Web Crypto API not available — using FNV hash. DO NOT use in production.");
    let hash = 2_166_136_261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = (hash * 16_777_619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}
// ---------------------------------------------------------------------------
// Constant-time string comparison
// ---------------------------------------------------------------------------
/**
 * Constant-time comparison of two strings.
 * Always processes both strings fully — no early exit on mismatch.
 */
function constantTimeEqual(a, b) {
    if (a.length !== b.length) {
        // Length leak is acceptable here because all SHA-256 hashes are the same
        // length (64 hex chars). If lengths differ, someone sent a non-hash.
        return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) ?? 0);
    }
    return diff === 0;
}
// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------
/**
 * Returns an Express middleware that validates the X-Api-Key header.
 *
 * @param expectedKeyHash  SHA-256 hex of the correct API key
 * @param required         If false, middleware is a no-op (dev/test mode)
 */
export function authMiddleware(expectedKeyHash, required) {
    return async function (req, res, next) {
        if (!required) {
            next();
            return;
        }
        const requestId = res.locals["requestId"] ?? "unknown";
        const providedKey = req.get("x-api-key");
        if (providedKey === undefined || providedKey.trim() === "") {
            send401(res, requestId);
            return;
        }
        let providedHash;
        try {
            providedHash = await sha256Hex(providedKey.trim());
        }
        catch {
            // Hashing failure is an internal error — treat as auth failure (safe default)
            send401(res, requestId);
            return;
        }
        if (!constantTimeEqual(providedHash, expectedKeyHash)) {
            send401(res, requestId);
            return;
        }
        next();
    };
}
// ---------------------------------------------------------------------------
// Utility — generate a hash from a raw key (for key setup / rotation)
// ---------------------------------------------------------------------------
/**
 * Given a raw API key string, return its SHA-256 hex hash.
 * Use this to generate the value for API_KEY_HASH env var.
 *
 * Example:
 *   const hash = await hashApiKey("my-secret-key");
 *   // Set API_KEY_HASH=<hash> in your .env
 */
export async function hashApiKey(rawKey) {
    return sha256Hex(rawKey);
}
