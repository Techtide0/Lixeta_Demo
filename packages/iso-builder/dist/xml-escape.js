/**
 * @file xml-escape.ts
 * @description Safe XML character escaping.
 *
 * Prevents injection of malformed XML through user-supplied strings
 * (names, account numbers, description fields).
 * Every string entering an XML element or attribute MUST go through `escapeXml`.
 */
const REPLACEMENTS = [
    [/&/g, "&amp;"],
    [/</g, "&lt;"],
    [/>/g, "&gt;"],
    [/"/g, "&quot;"],
    [/'/g, "&apos;"],
];
/**
 * Escape a string for safe embedding in XML element content or attribute values.
 */
export function escapeXml(input) {
    let out = input;
    for (const [pattern, replacement] of REPLACEMENTS) {
        out = out.replace(pattern, replacement);
    }
    return out;
}
/**
 * Strip all non-alphanumeric characters from an ID string.
 * IDs in ISO 20022 messages must match [A-Za-z0-9\-]{1,35}.
 */
export function sanitizeId(input) {
    return input.replace(/[^A-Za-z0-9\-_]/g, "").slice(0, 35);
}
/**
 * Validate that a currency code is exactly 3 uppercase letters (ISO 4217).
 */
export function assertCurrencyCode(code) {
    if (!/^[A-Z]{3}$/.test(code)) {
        throw new Error(`Invalid currency code: "${code}". Must be 3 uppercase letters (ISO 4217).`);
    }
}
/**
 * Validate that an amount is a positive integer (minor units, e.g. kobo).
 */
export function assertPositiveMinorUnits(amount) {
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error(`Invalid amount: ${amount}. Must be a positive integer (minor units).`);
    }
}
