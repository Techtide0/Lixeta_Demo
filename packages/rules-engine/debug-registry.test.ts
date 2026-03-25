// Quick debug test to check registry status
import { describe, it, expect } from "vitest";
import {
  registerBuiltinRules,
  listRegisteredRuleIds,
  freezeRegistry,
  _resetRegistryForTesting,
  SMART_NOTIFICATION_RULE_ID,
  TIMEZONE_RISK_RULE_ID,
} from "./src/index.js";

describe("🔍 Debug: Registry Setup", () => {
  it("full lifecycle: reset → register → freeze → list", () => {
    _resetRegistryForTesting();
    console.log(`Step 1 (after reset): ${listRegisteredRuleIds().join(", ")}`);
    
    registerBuiltinRules();
    const beforeFreeze = listRegisteredRuleIds();
    console.log(`Step 2 (after register): ${beforeFreeze.join(", ")}`);
    expect(beforeFreeze).toContain(SMART_NOTIFICATION_RULE_ID);
    expect(beforeFreeze).toContain(TIMEZONE_RISK_RULE_ID);
    
    freezeRegistry();
    const afterFreeze = listRegisteredRuleIds();
    console.log(`Step 3 (after freeze): ${afterFreeze.join(", ")}`);
    expect(afterFreeze).toEqual(beforeFreeze);
  });
});
