/**
 * @file lib/request-id.ts
 * @description Per-request ID generator.
 * Format: req_{timestamp}_{counter}
 */

let _counter = 0;

/**
 * Generates a unique request ID.
 * Format: req_{timestamp in ms}_{counter}
 * Counter wraps at 1 million to keep IDs reasonably short.
 */
export function generateRequestId(): string {
  const ts = Date.now();
  const counter = (_counter++) % 1_000_000;
  return `req_${ts}_${counter}`;
}
