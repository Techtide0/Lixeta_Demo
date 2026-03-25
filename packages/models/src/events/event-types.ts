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
export const MESSAGE_SENT = "message.sent" as const;
export const MESSAGE_DELIVERED = "message.delivered" as const;
export const MESSAGE_FAILED = "message.failed" as const;
export const MESSAGE_READ = "message.read" as const;
export const MESSAGE_RETRIED = "message.retried" as const;

// ---------------------------------------------------------------------------
// Payment Events
// ---------------------------------------------------------------------------
export const PAYMENT_INITIATED = "payment.initiated" as const;
export const PAYMENT_SUCCEEDED = "payment.succeeded" as const;
export const PAYMENT_FAILED = "payment.failed" as const;
export const PAYMENT_REVERSED = "payment.reversed" as const;
export const PAYMENT_TIMEOUT = "payment.timeout" as const;

// ---------------------------------------------------------------------------
// Session / User Events
// ---------------------------------------------------------------------------
export const SESSION_STARTED = "session.started" as const;
export const SESSION_ENDED = "session.ended" as const;
export const USER_AUTHENTICATED = "user.authenticated" as const;
export const USER_DEAUTHENTICATED = "user.deauthenticated" as const;
/** Aliases — map legacy/shorthand names to the canonical domain events */
export const USER_LOGIN = "user.login" as const;
export const USER_LOGOUT = "user.logout" as const;

// ---------------------------------------------------------------------------
// Rules Engine Events
// ---------------------------------------------------------------------------
export const RULE_FIRED = "rule.fired" as const;
export const RULE_SKIPPED = "rule.skipped" as const;
export const RULE_ERROR = "rule.error" as const;

// ---------------------------------------------------------------------------
// Simulation Control Events
// ---------------------------------------------------------------------------
export const SIMULATION_STARTED = "simulation.started" as const;
export const SIMULATION_PAUSED = "simulation.paused" as const;
export const SIMULATION_RESUMED = "simulation.resumed" as const;
export const SIMULATION_COMPLETED = "simulation.completed" as const;
export const SIMULATION_RESET = "simulation.reset" as const;

// ---------------------------------------------------------------------------
// Risk Events
// ---------------------------------------------------------------------------
export const RISK_THRESHOLD_BREACHED = "risk.threshold_breached" as const;
export const RISK_FLAG_RAISED = "risk.flag_raised" as const;
export const RISK_FLAG_CLEARED = "risk.flag_cleared" as const;

// ---------------------------------------------------------------------------
// Revenue Events
// ---------------------------------------------------------------------------
export const REVENUE_EARNED = "revenue.earned" as const;
export const REVENUE_LOST = "revenue.lost" as const;
export const REVENUE_ADJUSTED = "revenue.adjusted" as const;

// ---------------------------------------------------------------------------
// Canonical Union Type
// ---------------------------------------------------------------------------

/**
 * All valid event type strings in the system.
 * Derived directly from the constants above — adding a constant here
 * automatically widens the union without any further changes.
 */
export type EventType =
  // Messaging
  | typeof MESSAGE_SENT
  | typeof MESSAGE_DELIVERED
  | typeof MESSAGE_FAILED
  | typeof MESSAGE_READ
  | typeof MESSAGE_RETRIED
  // Payment
  | typeof PAYMENT_INITIATED
  | typeof PAYMENT_SUCCEEDED
  | typeof PAYMENT_FAILED
  | typeof PAYMENT_REVERSED
  | typeof PAYMENT_TIMEOUT
  // Session / User
  | typeof SESSION_STARTED
  | typeof SESSION_ENDED
  | typeof USER_AUTHENTICATED
  | typeof USER_DEAUTHENTICATED
  | typeof USER_LOGIN
  | typeof USER_LOGOUT
  // Rules Engine
  | typeof RULE_FIRED
  | typeof RULE_SKIPPED
  | typeof RULE_ERROR
  // Simulation Control
  | typeof SIMULATION_STARTED
  | typeof SIMULATION_PAUSED
  | typeof SIMULATION_RESUMED
  | typeof SIMULATION_COMPLETED
  | typeof SIMULATION_RESET
  // Risk
  | typeof RISK_THRESHOLD_BREACHED
  | typeof RISK_FLAG_RAISED
  | typeof RISK_FLAG_CLEARED
  // Revenue
  | typeof REVENUE_EARNED
  | typeof REVENUE_LOST
  | typeof REVENUE_ADJUSTED;

/**
 * Canonical list of all EventType values.
 * Used for validation and iteration.
 */
export const ALL_EVENT_TYPES: ReadonlyArray<EventType> = [
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
  USER_LOGIN,
  USER_LOGOUT,
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
export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && ALL_EVENT_TYPES.includes(value as EventType);
}


