---
"biome-one-liner-plugin": patch
---

The multiline object/array "may fit on one line" warning now measures the full
variable statement — the `const`/`let`/`var` keyword, the name, the type
annotation, the `=`, the object/array, and the trailing `;` — instead of just
the declarator.

Previously the gate counted only the declarator (name + type + `=` + object),
which lands exactly at the line-width boundary for a small object under a long
name + type annotation, e.g.:

```ts
const freeUnitsByPlan: Record<PlanId, number | null> = {
  just_exploring: null,
  pay_as_you_go: null,
  starter: null,
  premium: null,
};
```

The declarator fits within the width, so the warning fired even though the
actual one-liner (with the `const` keyword and `;`) exceeds it. The gate now
includes the whole declaration line, so this false positive is suppressed.
