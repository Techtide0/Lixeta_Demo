/**
 * @rules-engine — Engine V1 public API
 *
 * Import strategy:
 *   import { evaluateEvent, buildEngineConfig, registerBuiltinRules } from "@rules-engine";
 */
export { evaluateEvent } from "./core/evaluate-event.js";
export type { EngineEvaluationOutput } from "./core/evaluate-event.js";
export { buildEngineConfig, DEFAULT_EXECUTION_LIMITS, DEFAULT_SECURITY_POLICY, PRODUCTION_SECURITY_POLICY, } from "./core/engine-config.js";
export type { EngineConfig, EngineExecutionLimits, EngineSecurityPolicy, RevenueCurrencyConfig, } from "./core/engine-config.js";
export type { Rule, RuleEvaluationResult, VerdictContribution } from "./core/rule.js";
export { allowContribution, blockContribution, flagContribution, noOpinion, mergeVerdicts, } from "./core/rule.js";
export type { EvaluationContext, EmitRevenueFn, EmitRiskFn } from "./core/evaluation-context.js";
export { registerRule, freezeRegistry, isRegistryFrozen, getEnabledRules, getRule, listRegisteredRuleIds, registeredRuleCount, _resetRegistryForTesting, } from "./registry/rule-registry.js";
export { registerBuiltinRules, ALL_BUILTIN_RULE_IDS, SMART_NOTIFICATION_RULE_ID, TIMEZONE_RISK_RULE_ID, ACTIVE_HOURS_RULE_ID, SLA_KILLSWITCH_RULE_ID, DIASPORA_RISK_RULE_ID, _resetBuiltinRegistrationFlag, } from "./registry/default-rules.js";
export { runSecurityGuard } from "./security/security-guard.js";
export type { SecurityGuardResult, SecurityRejectionCode } from "./security/security-guard.js";
export { smartNotificationRule } from "./rules/smart-notification.rule.js";
export { timezoneRiskRule } from "./rules/timezone-risk.rule.js";
export { activeHoursRule } from "./rules/active-hours.rule.js";
export { slaKillswitchRule } from "./rules/sla-killswitch.rule.js";
export { diasporaRiskRule } from "./rules/diaspora-risk.rule.js";
export { generateTraceId, generateRevenueEventId, generateRiskEventId, generateDecisionId, _resetCounterForTesting, } from "./utils/id-generator.js";
