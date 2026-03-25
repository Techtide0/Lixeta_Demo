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
import { registerRule } from "../registry/rule-registry.js";
import { smartNotificationRule, SMART_NOTIFICATION_RULE_ID } from "../rules/smart-notification.rule.js";
import { timezoneRiskRule, TIMEZONE_RISK_RULE_ID } from "../rules/timezone-risk.rule.js";
import { activeHoursRule, ACTIVE_HOURS_RULE_ID } from "../rules/active-hours.rule.js";
import { slaKillswitchRule, SLA_KILLSWITCH_RULE_ID } from "../rules/sla-killswitch.rule.js";
import { diasporaRiskRule, DIASPORA_RISK_RULE_ID } from "../rules/diaspora-risk.rule.js";
export { SMART_NOTIFICATION_RULE_ID, TIMEZONE_RISK_RULE_ID, ACTIVE_HOURS_RULE_ID, SLA_KILLSWITCH_RULE_ID, DIASPORA_RISK_RULE_ID, };
/**
 * All built-in rule IDs. Use this to create a fully-enabled EngineConfig.
 */
export const ALL_BUILTIN_RULE_IDS = [
    SMART_NOTIFICATION_RULE_ID,
    TIMEZONE_RISK_RULE_ID,
    ACTIVE_HOURS_RULE_ID,
    SLA_KILLSWITCH_RULE_ID,
    DIASPORA_RISK_RULE_ID,
];
let _registered = false;
/**
 * Register all built-in rules.
 * Safe to call multiple times — subsequent calls are no-ops unless the
 * registry has been reset (test environments only).
 */
export function registerBuiltinRules() {
    if (_registered)
        return;
    registerRule(smartNotificationRule);
    registerRule(timezoneRiskRule);
    registerRule(activeHoursRule);
    registerRule(slaKillswitchRule);
    registerRule(diasporaRiskRule);
    _registered = true;
}
/** FOR TESTING ONLY — resets the registered flag. */
export function _resetBuiltinRegistrationFlag() {
    if (process.env["NODE_ENV"] === "production") {
        throw new Error("_resetBuiltinRegistrationFlag() is not allowed in production.");
    }
    _registered = false;
}
