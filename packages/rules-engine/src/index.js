/**
 * @rules-engine — Engine V1 public API
 *
 * Import strategy:
 *   import { evaluateEvent, buildEngineConfig, registerBuiltinRules } from "@rules-engine";
 */
// Core
export { evaluateEvent } from "./core/evaluate-event.js";
// Config
export { buildEngineConfig, DEFAULT_EXECUTION_LIMITS, DEFAULT_SECURITY_POLICY, PRODUCTION_SECURITY_POLICY, } from "./core/engine-config.js";
export { allowContribution, blockContribution, flagContribution, noOpinion, mergeVerdicts, } from "./core/rule.js";
// Registry
export { registerRule, freezeRegistry, isRegistryFrozen, getEnabledRules, getRule, listRegisteredRuleIds, registeredRuleCount, _resetRegistryForTesting, } from "./registry/rule-registry.js";
export { registerBuiltinRules, ALL_BUILTIN_RULE_IDS, SMART_NOTIFICATION_RULE_ID, TIMEZONE_RISK_RULE_ID, ACTIVE_HOURS_RULE_ID, SLA_KILLSWITCH_RULE_ID, DIASPORA_RISK_RULE_ID, _resetBuiltinRegistrationFlag, } from "./registry/default-rules.js";
// Security
export { runSecurityGuard } from "./security/security-guard.js";
// Rules (for extension / testing)
export { smartNotificationRule } from "./rules/smart-notification.rule.js";
export { timezoneRiskRule } from "./rules/timezone-risk.rule.js";
export { activeHoursRule } from "./rules/active-hours.rule.js";
export { slaKillswitchRule } from "./rules/sla-killswitch.rule.js";
export { diasporaRiskRule } from "./rules/diaspora-risk.rule.js";
// Utils
export { generateTraceId, generateRevenueEventId, generateRiskEventId, generateDecisionId, _resetCounterForTesting, } from "./utils/id-generator.js";
