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
// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------
const _rules = new Map();
const _order = [];
let _frozen = false;
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
/**
 * Register a rule with the engine.
 * Throws if:
 *   - The registry is frozen
 *   - A rule with the same ID is already registered
 */
export function registerRule(rule) {
    if (_frozen) {
        throw new Error(`[RuleRegistry] Cannot register rule "${rule.id}" — registry is frozen. ` +
            "Call registerRule() before freeze().");
    }
    if (_rules.has(rule.id)) {
        throw new Error(`[RuleRegistry] Duplicate rule ID detected: "${rule.id}". ` +
            "Each rule must have a globally unique ID. Retire old IDs before reusing.");
    }
    _rules.set(rule.id, rule);
    _order.push(rule.id);
}
/**
 * Freeze the registry. After this, no new rules can be registered.
 * Should be called once at application startup, after all rules are loaded.
 */
export function freezeRegistry() {
    _frozen = true;
}
/**
 * Returns true if the registry has been frozen.
 */
export function isRegistryFrozen() {
    return _frozen;
}
// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------
/**
 * Return an ordered list of all registered rules whose IDs appear in
 * `enabledRuleIds`. Preserves registration order.
 *
 * Rules not present in `enabledRuleIds` are silently excluded.
 * Rules listed in `enabledRuleIds` but not registered emit a warning
 * (and are skipped) — this prevents silent misconfiguration.
 */
export function getEnabledRules(enabledRuleIds) {
    const enabledSet = new Set(enabledRuleIds);
    const result = [];
    // Walk in registration order so priority is deterministic
    for (const id of _order) {
        if (enabledSet.has(id)) {
            const rule = _rules.get(id);
            if (rule !== undefined)
                result.push(rule);
        }
    }
    // Warn about IDs that were requested but not found
    for (const id of enabledRuleIds) {
        if (!_rules.has(id)) {
            // Non-fatal: log and continue. The engine skips unknown IDs gracefully.
            console.warn(`[RuleRegistry] Warning: enabled rule "${id}" is not registered. ` +
                "It will be skipped. Check your EngineConfig.enabledRuleIds.");
        }
    }
    return result;
}
/**
 * Look up a single rule by ID. Returns undefined if not registered.
 */
export function getRule(id) {
    return _rules.get(id);
}
/**
 * Returns all registered rule IDs in registration order.
 */
export function listRegisteredRuleIds() {
    return [..._order];
}
/**
 * Returns the total number of registered rules.
 */
export function registeredRuleCount() {
    return _rules.size;
}
// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------
/**
 * Reset the registry to an empty state.
 * FOR TESTING ONLY. Throws in production (NODE_ENV === "production").
 */
export function _resetRegistryForTesting() {
    if (process.env["NODE_ENV"] === "production") {
        throw new Error("[RuleRegistry] _resetRegistryForTesting() is not allowed in production.");
    }
    _rules.clear();
    _order.length = 0;
    _frozen = false;
}
