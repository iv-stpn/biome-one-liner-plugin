---
"biome-one-liner-plugin": patch
---

Fix the `collapse-object-definitions` fixer leaving most flagged sites unfixed. Three bugs:

- **Multi-member nodes were skipped.** The previous "stop corrupting multi-member type aliases" fix made the fixer refuse to touch any node with more than one member/element, so the bulk of the plugin's "may fit on one line" warnings (multi-member type aliases, multi-property objects, multi-element arrays) were never collapsed. The fixer now joins **every** member/element onto one line instead of only the first, so nothing is dropped: `type Point = { x: number; y: number }`, `const p = { x: 0, y: 1 }`, `const a = ["a", "b"]`.
- **Non-idempotent on nested-multiline members.** A single-member node whose member is itself multiline (e.g. `type R = { results: Array<\n  | { ok: true }\n  | { ok: false }\n> }`) was "collapsed" by removing only the outer braces, leaving a result that still spanned multiple lines — so the fixer re-"fixed" the same site every run without silencing the diagnostic. Such nodes are now skipped (the collapse would not be a genuine one-liner).
- **Leading comments caused false skips.** The comment guard inspected `getFullText()`, which includes leading trivia, so any declaration preceded by a `//` comment was skipped even though the comment is outside the collapsed region and never touched. The guard now inspects only the exact text being replaced.
