/**
 * @file lib/validate.ts
 * @description Runtime request body validation — zero external dependencies.
 *
 * Implements a lightweight schema builder that mirrors the Zod safeParse API
 * used throughout the gateway. When npm packages are available, swap
 * `import { z } from "zod"` back in — the rest of the codebase is unchanged.
 *
 * Security notes
 * ──────────────
 * • Unknown keys in the request body are DROPPED (`.strip()` semantics).
 * • Enum validation is strict — unlisted channel values are rejected.
 * • String length limits prevent memory exhaustion from crafted inputs.
 */
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function buildError(fieldErrors, formErrors = []) {
    return {
        flatten: () => ({ fieldErrors, formErrors }),
    };
}
function fail(field, msg) {
    return { success: false, error: buildError({ [field]: [msg] }) };
}
function formFail(msg) {
    return { success: false, error: buildError({}, [msg]) };
}
function ok(data) {
    return { success: true, data };
}
function isPlain(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
// ---------------------------------------------------------------------------
// EventSource schema
// ---------------------------------------------------------------------------
const VALID_CHANNELS = new Set([
    "sms", "whatsapp", "email", "push", "in_app", "api", "internal", "unknown",
]);
function parseEventSource(raw) {
    if (!isPlain(raw))
        return formFail("source must be an object");
    const { id, name, version, channel } = raw;
    if (typeof id !== "string" || id.trim().length === 0 || id.length > 128)
        return fail("source.id", "Must be a non-empty string (max 128 chars)");
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 256)
        return fail("source.name", "Must be a non-empty string (max 256 chars)");
    if (typeof version !== "string" || version.trim().length === 0 || version.length > 32)
        return fail("source.version", "Must be a non-empty string (max 32 chars)");
    if (typeof channel !== "string" || !VALID_CHANNELS.has(channel))
        return fail("source.channel", `Must be one of: ${[...VALID_CHANNELS].join(", ")}`);
    return ok({
        id: id.trim(),
        name: name.trim(),
        version: version.trim(),
        channel: channel,
    });
}
// ---------------------------------------------------------------------------
// TriggerEvent schema
// ---------------------------------------------------------------------------
const triggerEventBodySchema = {
    safeParse(raw) {
        if (!isPlain(raw))
            return formFail("Request body must be a JSON object");
        const { type, payload, timestamp, source, correlationId } = raw;
        // type
        if (typeof type !== "string" || type.trim().length === 0)
            return fail("type", "Required non-empty string");
        if (type.length > 128)
            return fail("type", "Must not exceed 128 characters");
        // payload
        if (!isPlain(payload))
            return fail("payload", "Required — must be a JSON object");
        // timestamp (optional)
        if (timestamp !== undefined && typeof timestamp !== "string")
            return fail("timestamp", "Must be an ISO 8601 string if provided");
        // source (optional)
        let parsedSource;
        if (source !== undefined) {
            const srcResult = parseEventSource(source);
            if (!srcResult.success)
                return srcResult;
            parsedSource = srcResult.data;
        }
        // correlationId (optional)
        if (correlationId !== undefined) {
            if (typeof correlationId !== "string" || correlationId.length > 128)
                return fail("correlationId", "Must be a string (max 128 chars) if provided");
        }
        const result = {
            type: type.trim(),
            payload: payload,
            ...(timestamp !== undefined ? { timestamp } : {}),
            ...(parsedSource !== undefined ? { source: parsedSource } : {}),
            ...(correlationId !== undefined ? { correlationId } : {}),
        };
        return ok(result);
    },
};
export { triggerEventBodySchema };
export function parseBody(schema, body) {
    const result = schema.safeParse(body);
    if (result.success) {
        return { ok: true, data: result.data };
    }
    const flat = result.error.flatten();
    return { ok: false, fieldErrors: flat.fieldErrors, formErrors: flat.formErrors };
}
