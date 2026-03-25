/**
 * @file event-types.ts
 * @description Centralized registry of ALL possible event types in the system.
 *
 * RULE: No raw string literals like "message.sent" may appear anywhere else in the
 *       codebase. All consumers MUST reference these exported constants or the
 *       EventType union type.
 */
// ---------------------------------------------------------------------------
// Messaging Events
// ---------------------------------------------------------------------------
export const MESSAGE_SENT = "message.sent";
export const MESSAGE_DELIVERED = "message.delivered";
export const MESSAGE_FAILED = "message.failed";
export const MESSAGE_READ = "message.read";
export const MESSAGE_RETRIED = "message.retried";
// ---------------------------------------------------------------------------
// Payment Events
// ---------------------------------------------------------------------------
export const PAYMENT_INITIATED = "payment.initiated";
export const PAYMENT_SUCCEEDED = "payment.succeeded";
export const PAYMENT_FAILED = "payment.failed";
export const PAYMENT_REVERSED = "payment.reversed";
export const PAYMENT_TIMEOUT = "payment.timeout";
// ---------------------------------------------------------------------------
// Session / User Events
// ---------------------------------------------------------------------------
export const SESSION_STARTED = "session.started";
export const SESSION_ENDED = "session.ended";
export const USER_AUTHENTICATED = "user.authenticated";
export const USER_DEAUTHENTICATED = "user.deauthenticated";
// ---------------------------------------------------------------------------
// Rules Engine Events
// ---------------------------------------------------------------------------
export const RULE_FIRED = "rule.fired";
export const RULE_SKIPPED = "rule.skipped";
export const RULE_ERROR = "rule.error";
// ---------------------------------------------------------------------------
// Simulation Control Events
// ---------------------------------------------------------------------------
export const SIMULATION_STARTED = "simulation.started";
export const SIMULATION_PAUSED = "simulation.paused";
export const SIMULATION_RESUMED = "simulation.resumed";
export const SIMULATION_COMPLETED = "simulation.completed";
export const SIMULATION_RESET = "simulation.reset";
// ---------------------------------------------------------------------------
// Risk Events
// ---------------------------------------------------------------------------
export const RISK_THRESHOLD_BREACHED = "risk.threshold_breached";
export const RISK_FLAG_RAISED = "risk.flag_raised";
export const RISK_FLAG_CLEARED = "risk.flag_cleared";
// ---------------------------------------------------------------------------
// Revenue Events
// ---------------------------------------------------------------------------
export const REVENUE_EARNED = "revenue.earned";
export const REVENUE_LOST = "revenue.lost";
export const REVENUE_ADJUSTED = "revenue.adjusted";
/**
 * Canonical list of all EventType values.
 * Used for validation and iteration.
 */
export const ALL_EVENT_TYPES = [
    MESSAGE_SENT,
    MESSAGE_DELIVERED,
    MESSAGE_FAILED,
    MESSAGE_READ,
    MESSAGE_RETRIED,
    PAYMENT_INITIATED,
    PAYMENT_SUCCEEDED,
    PAYMENT_FAILED,
    PAYMENT_REVERSED,
    PAYMENT_TIMEOUT,
    SESSION_STARTED,
    SESSION_ENDED,
    USER_AUTHENTICATED,
    USER_DEAUTHENTICATED,
    RULE_FIRED,
    RULE_SKIPPED,
    RULE_ERROR,
    SIMULATION_STARTED,
    SIMULATION_PAUSED,
    SIMULATION_RESUMED,
    SIMULATION_COMPLETED,
    SIMULATION_RESET,
    RISK_THRESHOLD_BREACHED,
    RISK_FLAG_RAISED,
    RISK_FLAG_CLEARED,
    REVENUE_EARNED,
    REVENUE_LOST,
    REVENUE_ADJUSTED,
];
/**
 * Runtime guard: is the given value a valid EventType?
 */
export function isEventType(value) {
    return typeof value === "string" && ALL_EVENT_TYPES.includes(value);
}
