---
"biome-one-liner-plugin": minor
---

Collapse single-return arrow function bodies into concise one-liners
(`(x) => { return expr; }` → `(x) => expr`). Only the block body is rewritten,
so parameters, type parameters, and return-type annotations are preserved. The
fix is skipped for empty `return;` bodies and bodies containing comments;
object-literal and sequence-expression returns are wrapped in parentheses.
`function` declarations and expressions are intentionally left untouched.
