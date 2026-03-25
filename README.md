# `packages/models` — Domain Language Package

The single source of truth for every type, interface, constant, and
factory in the simulation engine. Every other package imports from here.

---

## Directory layout

```
packages/models/
├── src/
│   ├── index.ts                    ← single public surface (@models)
│   ├── events/
│   │   ├── event-types.ts          ← centralised EventType registry + constants
│   │   ├── domain-event.ts         ← DomainEvent<T> + concrete event types
│   │   └── index.ts
│   ├── entities/
│   │   ├── simulation-state.ts     ← SimulationState (the session container)
│   │   ├── transaction.ts          ← Transaction, Money, TransactionParty
│   │   └── index.ts
│   ├── rules/
│   │   ├── rule-trace.ts           ← RuleTrace (audit log per evaluation)
│   │   ├── decision-result.ts      ← DecisionResult (engine verdict)
│   │   └── index.ts
│   ├── revenue/
│   │   ├── revenue-event.ts        ← RevenueEvent, RevenueAggregate
│   │   └── index.ts
│   ├── risk/
│   │   ├── risk-event.ts           ← RiskEvent, RiskEvidence, RiskAggregate
│   │   └── index.ts
│   └── utils/
│       ├── types.ts                ← Brand, Result, DeepReadonly, etc.
│       ├── validators.ts           ← runtime guards + ModelValidationError
│       ├── factories.ts            ← pure factory functions
│       └── index.ts
├── models.test.ts                  ← vitest-compatible tests (30 cases)
├── run-tests.ts                    ← zero-dep runner (tsx required)
├── tsconfig.json
├── tsconfig.build.json
├── package.json
└── README.md
```

---

## Core entities

| Entity | Purpose |
|---|---|
| `SimulationState` | Complete session state: events, transactions, revenue, risk, decisions |
| `DomainEvent<T>` | Atomic event flowing through the system; typed by `EventType` |
| `DecisionResult` | Rules engine verdict for one event: allow / block / flag / transform / defer |
| `RevenueEvent` | Revenue impact record (gain or loss) linked to a domain event |
| `RiskEvent` | Risk signal with typed evidence (timezone, velocity, geo, amount…) |
| `RuleTrace` | Full audit log of one rule evaluation: conditions, actions, explanation |
| `Transaction` | Financial or messaging transaction; the primary rules evaluation subject |
| `Money` | Explicit currency struct — amount in minor units + ISO 4217 code |

---

## EventType registry

All event type strings live exclusively in `src/events/event-types.ts`.

```ts
// ✓  Correct — reference the constant
import { MESSAGE_SENT } from "@models";
event.type === MESSAGE_SENT;

// ✗  Forbidden — never hardcode
event.type === "message.sent";
```

Adding a new event type requires:
1. Add a `const` in `event-types.ts`
2. Add it to the `EventType` union
3. Add it to `ALL_EVENT_TYPES`
4. Optionally add a concrete typed event interface in `domain-event.ts`

TypeScript's exhaustiveness checker (`assertNever`) will surface any
switch statements that forget to handle the new type.

---

## Importing

```ts
// Recommended — full namespace import
import type { DomainEvent, SimulationState, RiskEvent } from "@models";
import { MESSAGE_SENT, createDomainEvent, isEventType } from "@models";

// Sub-path import for bundle-splitting
import type { EventType } from "@models/events";
import type { DecisionResult } from "@models/rules";
```

Never import directly from internal sub-modules:
```ts
// ✗ forbidden
import { ... } from "@models/src/events/domain-event";
```

---

## TypeScript configuration

Compiled with the strictest available flags:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitReturns: true`
- `noImplicitOverride: true`
- `noPropertyAccessFromIndexSignature: true`

Zero `any` types. Every field is explicitly typed.

---

## Scripts

```bash
# Type-check only (no emit)
tsc --noEmit

# Build to dist/
tsc --project tsconfig.build.json

# Run tests (vitest — requires vitest in node_modules)
npx vitest run

# Run tests without vitest (tsx only)
tsx run-tests.ts
```

---

## Exit conditions met

- [x] All core models defined and exported
- [x] EventType registry centralised — no hardcoded strings elsewhere
- [x] TypeScript passes with `strict` mode + all additional strict flags
- [x] Zero `any` types
- [x] 30 / 30 tests passing
- [x] Any package can `import from "@models"` and immediately use typed structures
