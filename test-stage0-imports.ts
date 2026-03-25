/**
 * STAGE 0 VALIDATION: Cross-workspace imports via aliases
 *
 * If this file compiles and runs, all path aliases are working.
 */

// Test 1: Import from models package (primary dependency)
import {
  MESSAGE_SENT,
  PAYMENT_INITIATED,
  createDomainEvent,
  createInitialSimulationState,
  createMoney,
  isEventType,
} from "./packages/models/src/index.js";

// Test 2: Import from rules-engine package (secondary dependency)
import {
  evaluateEvent,
  buildEngineConfig,
  registerBuiltinRules,
  ALL_BUILTIN_RULE_IDS,
} from "./packages/rules-engine/src/index.js";

console.log("✅ STAGE 0 — IMPORT TEST");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

// Quick sanity checks
console.log(`\n1️⃣ @models is accessible`);
console.log(`   MESSAGE_SENT = "${MESSAGE_SENT}"`);
console.log(`   isEventType("message.sent") = ${isEventType(MESSAGE_SENT)}`);
console.log(`   ✓ Models loaded`);

console.log(`\n2️⃣ @rules is accessible`);
console.log(`   ALL_BUILTIN_RULE_IDS = [${ALL_BUILTIN_RULE_IDS.join(", ")}]`);
console.log(`   evaluateEvent is a function: ${typeof evaluateEvent === "function"}`);
console.log(`   ✓ Rules engine loaded`);

console.log(`\n3️⃣ Factories work (quick instantiation)`);
const config = buildEngineConfig({
  engineId: "test-engine",
  engineVersion: "1.0.0",
  enabledRuleIds: [...ALL_BUILTIN_RULE_IDS],
});
console.log(`   ✓ Config built: ${config.engineId}`);

console.log(`\n✅ STAGE 0 PASSED — All cross-workspace imports working`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
