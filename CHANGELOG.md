# biome-one-liner-plugin

## 1.3.3

### Patch Changes

- 87cbbb9: Declare `@biomejs/biome` as a peer dependency (`>=2.5.3`) so consumers get a machine-enforced Biome version requirement, and fix two stale doc references: the README link to the test runner (now `scripts/run-tests.mjs`) and an `oneLiner.grit` comment pointing at a script that no longer exists.

## 1.3.2

### Patch Changes

- c482ab5: Internal tooling only — no change to the published `oneLiner.grit`. Run the CI
  and release workflows on Bun instead of npm (the repo migrated to a `bun.lock`
  lockfile), which fixes the "Dependencies lock file is not found" failure and
  drops the Node 20 deprecation warning by no longer pinning `node-version`.
  Restore `biome check --write` in the test runner so the formatter normalizes
  fixture indentation again (it had regressed to lint-only `biome lint --write`).

## 1.3.1

### Patch Changes

- d88494d: Emit `else` / `else if` branches on their own line instead of sharing the line
  with the `if` branch. `if (a) { foo(); } else { bar(); }` now fixes to
  `if (a) foo();` / `else bar();` directly (the fix inserts the line break, so it
  holds even under lint-only `--write` without the formatter).

## 1.3.0

### Minor Changes

- d8e92dd: Collapse three more single-statement blocks into one-liners, so every construct
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

- 1f601a0: Fix a correctness bug and add else-if unwrapping.

  - **Fix:** `for await (const x of y) { … }` is no longer collapsed. It parses as
    a `JsForOfStatement` whose `await` is a bare token (not a captured field), so
    the rewrite silently dropped the `await` and turned async iteration into sync
    iteration. Such loops are now guarded out and left braced.
  - **New:** unwrap an else-block whose sole statement is an `if`
    (`else { if (a) … }` → `else if (a) …`). This is safe — nothing follows an
    `else`, so there is no dangling-else hazard — and is the mirror image of the
    existing else-collapse rule, covering exactly the control-flow case the other
    rules skip. Skipped when the block contains a comment.

## 1.2.0

### Minor Changes

- 1081c6e: Collapse single-return arrow function bodies into concise one-liners
  (`(x) => { return expr; }` → `(x) => expr`). Only the block body is rewritten,
  so parameters, type parameters, and return-type annotations are preserved. The
  fix is skipped for empty `return;` bodies and bodies containing comments;
  object-literal and sequence-expression returns are wrapped in parentheses.
  `function` declarations and expressions are intentionally left untouched.

## 1.1.1

### Patch Changes

- Refresh README: remove internal predecessor references and reword for public accessibility.

## 1.1.0

### Minor Changes

- 6b99a69: Initial release of the Biome one-liner plugin.

  A GritQL Biome plugin that collapses single-statement blocks into one-liners
  (`if` / `else if` / `else` / `for` / `for-of` / `for-in` / `while`), porting
  `offkeep/scripts/refactor-one-liners.ts`. Skips control-flow bodies (dangling-else
  safety), lexical declarations (`let`/`const`/`class`/`function`, which would be
  invalid), and blocks containing comments.
