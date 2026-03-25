/**
 * @file default-rules.ts
 * @description Registers all built-in rules with the engine registry.
 *
 * Import this module exactly ONCE at application startup, before calling
 * `freezeRegistry()`. It is idempotent when tested (the test harness calls
 * `_resetRegistryForTesting()` between suites).
 *
 * To disable a rule without removing it:
 *   - Remove its ID from `EngineConfig.enabledRuleIds`
 *   - The rule stays in the registry but the engine skips it
 *
 * To add a new rule:
 *   1. Implement the `Rule` interface in `src/rules/your-rule.rule.ts`
 *   2. Import and call `registerRule(yourRule)` here
 *   3. Add its ID to `ALL_BUILTIN_RULE_IDS`
 */
import { SMART_NOTIFICATION_RULE_ID } from "../rules/smart-notification.rule.js";
import { TIMEZONE_RISK_RULE_ID } from "../rules/timezone-risk.rule.js";
import { ACTIVE_HOURS_RULE_ID } from "../rules/active-hours.rule.js";
import { SLA_KILLSWITCH_RULE_ID } from "../rules/sla-killswitch.rule.js";
import { DIASPORA_RISK_RULE_ID } from "../rules/diaspora-risk.rule.js";
export { SMART_NOTIFICATION_RULE_ID, TIMEZONE_RISK_RULE_ID, ACTIVE_HOURS_RULE_ID, SLA_KILLSWITCH_RULE_ID, DIASPORA_RISK_RULE_ID, };
/**
 * All built-in rule IDs. Use this to create a fully-enabled EngineConfig.
 */
export declare const ALL_BUILTIN_RULE_IDS: ReadonlyArray<string>;
/**
 * Register all built-in rules.
 * Safe to call multiple times — subsequent calls are no-ops unless the
 * registry has been reset (test environments only).
 */
export declare function registerBuiltinRules(): void;
/** FOR TESTING ONLY — resets the registered flag. */
export declare function _resetBuiltinRegistrationFlag(): void;
