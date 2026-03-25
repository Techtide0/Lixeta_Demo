/**
 * @file xml-escape.ts
 * @description Safe XML character escaping.
 *
 * Prevents injection of malformed XML through user-supplied strings
 * (names, account numbers, description fields).
 * Every string entering an XML element or attribute MUST go through `escapeXml`.
 */
/**
 * Escape a string for safe embedding in XML element content or attribute values.
 */
export declare function escapeXml(input: string): string;
/**
 * Strip all non-alphanumeric characters from an ID string.
 * IDs in ISO 20022 messages must match [A-Za-z0-9\-]{1,35}.
 */
export declare function sanitizeId(input: string): string;
/**
 * Validate that a currency code is exactly 3 uppercase letters (ISO 4217).
 */
export declare function assertCurrencyCode(code: string): void;
/**
 * Validate that an amount is a positive integer (minor units, e.g. kobo).
 */
export declare function assertPositiveMinorUnits(amount: number): void;
