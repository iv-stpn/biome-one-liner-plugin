---
"biome-one-liner-plugin": minor
---

Fix a correctness bug and add else-if unwrapping.

- **Fix:** `for await (const x of y) { … }` is no longer collapsed. It parses as
  a `JsForOfStatement` whose `await` is a bare token (not a captured field), so
  the rewrite silently dropped the `await` and turned async iteration into sync
  iteration. Such loops are now guarded out and left braced.
- **New:** unwrap an else-block whose sole statement is an `if`
  (`else { if (a) … }` → `else if (a) …`). This is safe — nothing follows an
  `else`, so there is no dangling-else hazard — and is the mirror image of the
  existing else-collapse rule, covering exactly the control-flow case the other
  rules skip. Skipped when the block contains a comment.
