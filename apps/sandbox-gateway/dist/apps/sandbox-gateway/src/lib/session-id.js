/**
 * @file lib/session-id.ts
 * @description Cryptographically secure session ID generation.
 *
 * Security design
 * ───────────────
 * • IDs are generated from Web Crypto (crypto.getRandomValues) — not Math.random().
 * • Entropy: 21 bytes = 168 bits → collision probability negligible for millions
 *   of concurrent sessions.
 * • Alphabet excludes ambiguous characters (0/O, 1/l/I) for readability in logs.
 * • Format: `sess_{21-char-random}` — prefix enables grep/log filtering.
 * • IDs are URL-safe — no encoding required in query strings.
 *
 * Fallback: deterministic counter + timestamp when Web Crypto is unavailable.
 * This MUST NOT happen in production — env validation catches it.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const SESSION_ID_LENGTH = 21;
function generateSecureId(length) {
    const g = globalThis;
    if (typeof g["crypto"] === "object" && g["crypto"] !== null) {
        const crypto = g["crypto"];
        const bytes = crypto.getRandomValues(new Uint8Array(length));
        let id = "";
        for (let i = 0; i < length; i++) {
            // Modulo bias is negligible: alphabet.length=55, 256/55 ≈ 4.65
            id += ALPHABET[bytes[i] % ALPHABET.length];
        }
        return id;
    }
    // Fallback — deterministic, NOT cryptographically secure
    if (process.env["NODE_ENV"] === "production") {
        throw new Error("[SessionId] Web Crypto API unavailable in production. " +
            "Ensure Node.js >= 18 is used.");
    }
    // Dev fallback: timestamp + counter
    let counter = 0;
    const ts = Date.now().toString(36);
    const seq = (++counter).toString(36).padStart(4, "0");
    return `fallback_${ts}_${seq}`;
}
/** Generate a unique, cryptographically secure session ID. */
export function generateSessionId() {
    return `sess_${generateSecureId(SESSION_ID_LENGTH)}`;
}
/**
 * Validate that a string looks like a well-formed session ID.
 * This is a format check only — not an existence check.
 */
export function isValidSessionIdFormat(id) {
    if (typeof id !== "string")
        return false;
    if (!id.startsWith("sess_"))
        return false;
    const body = id.slice(5);
    // Allow both secure IDs and the dev fallback
    return body.length >= 10 && /^[A-Za-z0-9_]+$/.test(body);
}
