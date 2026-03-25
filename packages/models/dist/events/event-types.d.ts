/**
 * @file event-types.ts
 * @description Centralized registry of ALL possible event types in the system.
 *
 * RULE: No raw string literals like "message.sent" may appear anywhere else in the
 *       codebase. All consumers MUST reference these exported constants or the
 *       EventType union type.
 */
export declare const MESSAGE_SENT: "message.sent";
export declare const MESSAGE_DELIVERED: "message.delivered";
export declare const MESSAGE_FAILED: "message.failed";
export declare const MESSAGE_READ: "message.read";
export declare const MESSAGE_RETRIED: "message.retried";
export declare const PAYMENT_INITIATED: "payment.initiated";
export declare const PAYMENT_SUCCEEDED: "payment.succeeded";
export declare const PAYMENT_FAILED: "payment.failed";
export declare const PAYMENT_REVERSED: "payment.reversed";
export declare const PAYMENT_TIMEOUT: "payment.timeout";
export declare const SESSION_STARTED: "session.started";
export declare const SESSION_ENDED: "session.ended";
export declare const USER_AUTHENTICATED: "user.authenticated";
export declare const USER_DEAUTHENTICATED: "user.deauthenticated";
/** Aliases — map legacy/shorthand names to the canonical domain events */
export declare const USER_LOGIN: "user.login";
export declare const USER_LOGOUT: "user.logout";
export declare const RULE_FIRED: "rule.fired";
export declare const RULE_SKIPPED: "rule.skipped";
export declare const RULE_ERROR: "rule.error";
export declare const SIMULATION_STARTED: "simulation.started";
export declare const SIMULATION_PAUSED: "simulation.paused";
export declare const SIMULATION_RESUMED: "simulation.resumed";
export declare const SIMULATION_COMPLETED: "simulation.completed";
export declare const SIMULATION_RESET: "simulation.reset";
export declare const RISK_THRESHOLD_BREACHED: "risk.threshold_breached";
export declare const RISK_FLAG_RAISED: "risk.flag_raised";
export declare const RISK_FLAG_CLEARED: "risk.flag_cleared";
export declare const REVENUE_EARNED: "revenue.earned";
export declare const REVENUE_LOST: "revenue.lost";
export declare const REVENUE_ADJUSTED: "revenue.adjusted";
/**
 * All valid event type strings in the system.
 * Derived directly from the constants above — adding a constant here
 * automatically widens the union without any further changes.
 */
export type EventType = typeof MESSAGE_SENT | typeof MESSAGE_DELIVERED | typeof MESSAGE_FAILED | typeof MESSAGE_READ | typeof MESSAGE_RETRIED | typeof PAYMENT_INITIATED | typeof PAYMENT_SUCCEEDED | typeof PAYMENT_FAILED | typeof PAYMENT_REVERSED | typeof PAYMENT_TIMEOUT | typeof SESSION_STARTED | typeof SESSION_ENDED | typeof USER_AUTHENTICATED | typeof USER_DEAUTHENTICATED | typeof USER_LOGIN | typeof USER_LOGOUT | typeof RULE_FIRED | typeof RULE_SKIPPED | typeof RULE_ERROR | typeof SIMULATION_STARTED | typeof SIMULATION_PAUSED | typeof SIMULATION_RESUMED | typeof SIMULATION_COMPLETED | typeof SIMULATION_RESET | typeof RISK_THRESHOLD_BREACHED | typeof RISK_FLAG_RAISED | typeof RISK_FLAG_CLEARED | typeof REVENUE_EARNED | typeof REVENUE_LOST | typeof REVENUE_ADJUSTED;
/**
 * Canonical list of all EventType values.
 * Used for validation and iteration.
 */
export declare const ALL_EVENT_TYPES: ReadonlyArray<EventType>;
/**
 * Runtime guard: is the given value a valid EventType?
 */
export declare function isEventType(value: unknown): value is EventType;
