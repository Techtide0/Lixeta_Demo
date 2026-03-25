/**
 * @file rule-registry.ts
 * @description Compile-time and runtime registry for all engine rules.
 *
 * The registry is the ONLY place rules are registered. The engine reads from
 * it — it never constructs Rule objects directly. This enforces:
 *
 *   • Unique rule IDs  — duplicate IDs cause a hard startup error
 *   • Stable ordering  — rules run in the order they were registered
 *   • Enabled-set      — only rules listed in EngineConfig.enabledRuleIds fire
 *
 * Security notes
 * ──────────────
 * • `register()` is called at module load time (top-level), not at request
 *   time. This means the registry is immutable during a request — no runtime
 *   rule injection is possible.
 * • `freeze()` seals the registry after all rules are registered. Any
 *   subsequent `register()` call throws. Call this in your app entry point
 *   after all rules have been registered.
 */
import type { Rule } from "../core/rule.js";
/**
 * Register a rule with the engine.
 * Throws if:
 *   - The registry is frozen
 *   - A rule with the same ID is already registered
 */
export declare function registerRule(rule: Rule): void;
/**
 * Freeze the registry. After this, no new rules can be registered.
 * Should be called once at application startup, after all rules are loaded.
 */
export declare function freezeRegistry(): void;
/**
 * Returns true if the registry has been frozen.
 */
export declare function isRegistryFrozen(): boolean;
/**
 * Return an ordered list of all registered rules whose IDs appear in
 * `enabledRuleIds`. Preserves registration order.
 *
 * Rules not present in `enabledRuleIds` are silently excluded.
 * Rules listed in `enabledRuleIds` but not registered emit a warning
 * (and are skipped) — this prevents silent misconfiguration.
 */
export declare function getEnabledRules(enabledRuleIds: ReadonlyArray<string>): ReadonlyArray<Rule>;
/**
 * Look up a single rule by ID. Returns undefined if not registered.
 */
export declare function getRule(id: string): Rule | undefined;
/**
 * Returns all registered rule IDs in registration order.
 */
export declare function listRegisteredRuleIds(): ReadonlyArray<string>;
/**
 * Returns the total number of registered rules.
 */
export declare function registeredRuleCount(): number;
/**
 * Reset the registry to an empty state.
 * FOR TESTING ONLY. Throws in production (NODE_ENV === "production").
 */
export declare function _resetRegistryForTesting(): void;
