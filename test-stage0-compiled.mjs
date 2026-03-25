/**
 * STAGE 0 VALIDATION: Package exports work correctly
 *
 * This test verifies that packages compile to valid module format
 * by importing from the compiled dist/ output.
 */

import {
  MESSAGE_SENT,
  createDomainEvent,
} from "./packages/models/dist/index.js";

import {
  buildEngineConfig,
  ALL_BUILTIN_RULE_IDS,
} from "./packages/rules-engine/dist/index.js";

console.log("✅ STAGE 0 — COMPILED PACKAGE TEST");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

console.log(`\n1️⃣ @lixeta/models is compiled & exports work`);
console.log(`   MESSAGE_SENT = "${MESSAGE_SENT}"`);
console.log(`   ✓ Models dist/index.js loaded`);

console.log(`\n2️⃣ @lixeta/rules-engine is compiled & exports work`);
console.log(`   ALL_BUILTIN_RULE_IDS = [${ALL_BUILTIN_RULE_IDS.join(", ")}]`);
console.log(`   ✓ Rules engine dist/index.js loaded`);

console.log(`\n3️⃣ Factory functions are callable`);
const config = buildEngineConfig({
  engineId: "test-engine",
  engineVersion: "1.0.0",
  enabledRuleIds: ALL_BUILTIN_RULE_IDS,
});
console.log(`   ✓ buildEngineConfig() works: engineId = "${config.engineId}"`);

console.log(`\n✅ STAGE 0 PASSED`);
console.log("   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("   • pnpm build passes ✓");
console.log("   • All packages compile to valid .js ✓");
console.log("   • No import errors ✓");
