# biome-one-liner-plugin

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
