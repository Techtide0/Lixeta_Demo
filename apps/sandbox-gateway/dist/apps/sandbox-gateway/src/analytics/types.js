/**
 * @file analytics/types.ts
 * @description All output types produced by the analytics engine.
 *
 * Design principles
 * ─────────────────
 * • Every field in every type is derived — no manually maintained counters.
 * • Types mirror the API response shape 1:1, so the route handler does zero
 *   reshaping — it calls compute* and returns the result directly.
 * • `currency` is explicit on every monetary field — no implicit NGN assumption.
 * • Breakdowns nest into `*Breakdown` sub-objects so consumers can pick only
 *   what they need without parsing a flat struct.
 * • `derivedAt` marks the computation timestamp — consumers can tell whether
 *   the snapshot is fresh or pre-cached (Stage 6 can optionally cache).
 * • `eventCount` on every aggregate ensures partial-aggregation bugs are caught:
 *   if eventCount !== events.length the consumer knows something is wrong.
 *
 * Audit guarantee: given the same `events[]`, `revenueEvents[]`, `riskEvents[]`,
 * and `ruleTraces[]`, the analytics engine ALWAYS produces the same output.
 */
export {};
