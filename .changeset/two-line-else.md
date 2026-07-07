---
"biome-one-liner-plugin": patch
---

Emit `else` / `else if` branches on their own line instead of sharing the line
with the `if` branch. `if (a) { foo(); } else { bar(); }` now fixes to
`if (a) foo();` / `else bar();` directly (the fix inserts the line break, so it
holds even under lint-only `--write` without the formatter).
