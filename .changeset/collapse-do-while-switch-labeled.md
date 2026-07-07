---
"biome-one-liner-plugin": minor
---

Collapse three more single-statement blocks into one-liners, so every construct
the plugin flags now carries a safe auto-fix:

- `do { stmt; } while (c);` → `do stmt; while (c);`
- `switch` `case v: { stmt; }` / `default: { stmt; }` → `case v: stmt;` /
  `default: stmt;`, only when the block is the entire clause body (fall-through
  cases and clauses holding a `let`/`const`/`class` are left braced, since
  un-blocking would leak the binding across the whole switch);
- `label: { stmt; }` → `label: stmt;`, skipped when the sole statement is a loop
  so labeled-loop `break`/`continue` targets are preserved.

The three shared guards (control-flow-as-sole-statement, lexical declaration,
comment) are now factored into named GritQL patterns, and `do…while` was added
to the control-flow guard so the existing rules treat it consistently.
