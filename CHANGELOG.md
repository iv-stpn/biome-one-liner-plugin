# biome-one-liner-plugin

## 1.4.5

### Patch Changes

- a1c5ab5: Remove the GritQL autofix for single-member type aliases. `biome lint --write` no
  longer collapses any multiline object/array/type definitions — they are all
  warn-only in the plugin now (single- and multi-member type aliases are treated
  identically). The actual collapse is left entirely to the
  `collapse-object-definitions` fixer, which already handles every case. Run the
  fixer after `biome check --write` to apply these one-liners.

## 1.4.4

### Patch Changes

- a2cdff6: Fix the `collapse-object-definitions` fixer leaving most flagged sites unfixed. Three bugs:

  - **Multi-member nodes were skipped.** The previous "stop corrupting multi-member type aliases" fix made the fixer refuse to touch any node with more than one member/element, so the bulk of the plugin's "may fit on one line" warnings (multi-member type aliases, multi-property objects, multi-element arrays) were never collapsed. The fixer now joins **every** member/element onto one line instead of only the first, so nothing is dropped: `type Point = { x: number; y: number }`, `const p = { x: 0, y: 1 }`, `const a = ["a", "b"]`.
  - **Non-idempotent on nested-multiline members.** A single-member node whose member is itself multiline (e.g. `type R = { results: Array<\n  | { ok: true }\n  | { ok: false }\n> }`) was "collapsed" by removing only the outer braces, leaving a result that still spanned multiple lines — so the fixer re-"fixed" the same site every run without silencing the diagnostic. Such nodes are now skipped (the collapse would not be a genuine one-liner).
  - **Leading comments caused false skips.** The comment guard inspected `getFullText()`, which includes leading trivia, so any declaration preceded by a `//` comment was skipped even though the comment is outside the collapsed region and never touched. The guard now inspects only the exact text being replaced.

## 1.4.3

### Patch Changes

- 11297f3: Fix the `collapse-object-definitions` fixer corrupting multi-member type aliases: it collapsed them to their first member only, silently dropping every member after it. Multi-member type aliases are now left intact (warned, not rewritten), matching how multi-property object and multi-element array initializers were already handled. Also gate the multi-member type-alias "may fit on one line" warning on the line width (non-whitespace columns summed across every line of the node), so a definition whose own content exceeds the line width — e.g. a large `type ChoiceTabProps<…> = { … }` — no longer triggers a warning.

## 1.4.2

### Patch Changes

- 7b218e7: Move `@typescript/typescript6` from devDependencies to dependencies so the `collapse-object-definitions` fixer is runnable directly from a consuming project (not just from a checkout of this repo). Document the fixer — and how to invoke it — in the README.

## 1.4.1

### Patch Changes

- 0672c03: Gate the multiline object and array "may fit on one line" warnings on the line width. Previously these warnings fired on every multiline object/array initializer, assuming any of them could become a one-liner. They now stay silent when the definition's non-whitespace content alone exceeds the line width (110 columns), so the "may fit on one line" advice is no longer given for definitions that cannot fit.

## 1.4.0

### Minor Changes

- 82f3949: Add diagnostic warnings for multiline type aliases, object initializers, and array initializers that may fit on one line.

  - Single-member `type Foo = { … }` declarations get a safe autofix that collapses them to one line
  - Multi-member type aliases, multiline object initialisers (`const x = { … }`), and multiline array initialisers (`const x = [ … ]`) emit a warning
  - New `fixers/collapse-object-definitions.ts` engine applies those collapses by running Biome diagnostics and using the TypeScript compiler to locate and rewrite flagged nodes

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
