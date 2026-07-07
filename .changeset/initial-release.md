---
"biome-one-liner-plugin": minor
---

Initial release of the Biome one-liner plugin.

A GritQL Biome plugin that collapses single-statement blocks into one-liners
(`if` / `else if` / `else` / `for` / `for-of` / `for-in` / `while`), porting
`offkeep/scripts/refactor-one-liners.ts`. Skips control-flow bodies (dangling-else
safety), lexical declarations (`let`/`const`/`class`/`function`, which would be
invalid), and blocks containing comments.
