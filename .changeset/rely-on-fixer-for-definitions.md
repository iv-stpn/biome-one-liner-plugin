---
"biome-one-liner-plugin": patch
---

Remove the GritQL autofix for single-member type aliases. `biome lint --write` no
longer collapses any multiline object/array/type definitions — they are all
warn-only in the plugin now (single- and multi-member type aliases are treated
identically). The actual collapse is left entirely to the
`collapse-object-definitions` fixer, which already handles every case. Run the
fixer after `biome check --write` to apply these one-liners.
