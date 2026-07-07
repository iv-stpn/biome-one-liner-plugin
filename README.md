# biome-one-liner-plugin

A [Biome](https://biomejs.dev) plugin (written in [GritQL](https://biomejs.dev/blog/gritql-biome)) that collapses single-statement blocks into one-liners — turning the verbose form on the left into the tidy form on the right.

```ts
// before
if (cond) {
  return value;
}
if (a) { foo(); } else { bar(); }
for (const x of arr) {
  process(x);
}
while (cond) {
  doThing();
}
do {
  doThing();
} while (cond);
switch (x) {
  case 1: {
    handle();
  }
}
const inc = (n) => {
  return n + 1;
};

// after
if (cond) return value;
if (a) foo(); else bar();
for (const x of arr) process(x);
while (cond) doThing();
do doThing(); while (cond);
switch (x) {
  case 1: handle();
}
const inc = (n) => n + 1;
```

## What it collapses

| Construct | Transformation |
| --- | --- |
| `if (c) { stmt; }` | `if (c) stmt;` |
| `if (c) { stmt; } else …` | `if (c) stmt; else …` (else preserved) |
| `… else { stmt; }` | `… else stmt;` |
| `else if (c) { stmt; }` | `else if (c) stmt;` |
| `else { if (c) … }` | `else if (c) …` (unwrap to else-if) |
| `for (init; test; update) { stmt; }` | `for (init; test; update) stmt;` |
| `for (init of iter) { stmt; }` | `for (init of iter) stmt;` |
| `for (init in obj) { stmt; }` | `for (init in obj) stmt;` |
| `while (c) { stmt; }` | `while (c) stmt;` |
| `do { stmt; } while (c);` | `do stmt; while (c);` |
| `switch: case v: { stmt; }` | `case v: stmt;` |
| `switch: default: { stmt; }` | `default: stmt;` |
| `label: { stmt; }` | `label: stmt;` |
| `(x) => { return expr; }` | `(x) => expr` |

Multi-statement blocks are left untouched.

## What it deliberately leaves alone

A single-statement block is **not** collapsed when its statement:

- **is itself control flow** (`if` / `for` / `while` / `do…while` / `switch`) —
  this avoids dangling-else hazards, e.g. `if (a) { if (b) z(); }` stays as-is.
  The sole exception is an `else` whose only statement is an `if`, which is
  safely unwrapped to `else if` (nothing follows an `else`, so there is no
  dangling-else risk);
- **is a lexical declaration** (`let` / `const` / `class` / `function`) — these
  cannot legally be the sole body of a control-flow statement, so collapsing
  them would produce a parse error. (`var` is fine and is collapsed.);
- **contains a comment** — so no documentation is silently dropped. Blocks like
  `if (a) { /* keep */ return 1; }` are preserved verbatim.

The `switch` case/default collapse (`case v: { stmt; }` → `case v: stmt;`) only
fires when the block is the **entire** case body, so a fall-through case such as
`case 1: { x(); } break;` (two statements in the clause) is left alone. The
lexical-declaration guard matters most here: a `case` block scopes its
`let`/`const`/`class` to that clause, so un-blocking one would leak the binding
across the whole switch (and could collide with the same name in a sibling
clause) — those cases are kept braced.

The labeled-block collapse (`label: { stmt; }` → `label: stmt;`) is skipped when
the sole statement is control flow, so the common labeled-loop pattern
`outer: for (…) { … break outer; }` is preserved with its label attached to the
loop it targets.

A `for await (…) { stmt; }` loop is deliberately **not** collapsed. It parses as
an ordinary `for…of` node whose `await` is a bare token rather than a captured
field, so the rewrite cannot re-emit it — collapsing would silently drop the
`await` and turn async iteration into sync iteration. The braced form is kept.

The arrow-body collapse (`(x) => { return expr; }` → `(x) => expr`) rewrites only
the block body, so the arrow's parameters, type parameters, and return-type
annotation are preserved verbatim, and it is semantics-preserving (an arrow
captures `this`/`arguments` lexically in either body form). It is skipped when
the body:

- **has no return argument** (`return;`) — a concise body cannot express that;
- **contains a comment** — same rule as above.

An object-literal or sequence-expression return is wrapped in parentheses
(`() => ({ x: 1 })`, `() => (a, b)`) so it is not re-parsed as a block or a
comma expression. Only arrow functions are rewritten — `function` declarations
and expressions are left alone, since converting them would change hoisting and
`this`/`arguments` semantics and can drop `async`/generator/return-type
information.

## Usage

Install the plugin as a dev dependency:

```sh
npm install -D biome-one-liner-plugin
```

Reference it from your Biome configuration:

```jsonc
{
  "plugins": ["biome-one-liner-plugin/oneLiner.grit"],
  "linter": {
    "rules": { "recommended": true }
  }
}
```

Then run the linter with `--write` to apply the (safe) fixes:

```sh
npx @biomejs/biome lint --write <files>
# or, to also format the result:
npx @biomejs/biome check --write <files>
```

Without `--write`, the plugin only reports diagnostics (severity `warn`,
code `plugin`), so you can review before applying.

Requires Biome **2.5+** (GritQL plugins with code-fixes landed in v2.5).

> Using it directly from this repo instead? Set `"plugins": ["./oneLiner.grit"]`
> and point the path at the checked-out file.

## Try it

```sh
npm install
npx @biomejs/biome lint --write example.ts
```

## Tests

Snapshot tests live in [tests/](tests/). Each case is a pair:
`tests/fixtures/<name>.input.ts` (before) and `<name>.expected.ts` (after). The
runner ([tests/run.mjs](tests/run.mjs)) runs `biome check --write` on each input
with only the plugin enabled (no other lint rules) and compares against the
expected output.

```sh
npm test
```

Covered cases include every collapsed construct (`if` / `else if` / `else` /
`for` / `for-of` / `for-in` / `while` / `do-while` / `switch` case & default /
labeled block / `else { if … }` → `else if …`, including `for (;;)`, plus the
arrow-body collapse with object/sequence wrapping), and the non-collapsing cases:
multi-statement blocks, blocks whose body is itself control flow,
`let`/`const`/`class`/`function` bodies (vs. `var`, which collapses), blocks
containing comments, `function` declaration bodies (which are never touched),
fall-through `switch` cases and `case`/`default` blocks holding a lexical
declaration (which would leak scope across the switch), labeled loops (whose
`break`/`continue` target is preserved), `for await` loops (whose `await` cannot
be re-emitted), and arrow bodies that can't collapse (empty `return;`, comments,
multi-statement).

## Releasing

Versions and the changelog are managed with [Changesets](https://github.com/changesets/changesets).

1. Add a changeset describing a change: `npx changeset`.
2. Commit the changeset to your branch.
3. On merge to `main`, the [Release workflow](.github/workflows/release.yml)
   opens a "Version Packages" pull request that bumps the version and updates
   `CHANGELOG.md`.
4. Merge that PR and the workflow publishes the new version to npm.

The workflow needs an `NPM_TOKEN` secret in the repo (an npm
[automation access token](https://docs.npmjs.com/creating-and-viewing-access-tokens)).
Add it under **Settings → Secrets and variables → Actions**. CI runs the test
suite on every push and pull request ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## How it works

The plugin is one Biome plugin file. It matches `if` / `for` / `for-of` /
`for-in` / `while` / `do-while` statements, `switch` `case`/`default` clauses,
and labeled statements whose body is a `JsBlockStatement` with exactly one
statement (`statements=[$s]`), guarded by the three shared patterns
(`control_flow_statement`, `lexical_declaration`, `has_comment`) defined at the
top of the file, and rewrites the block away via the GritQL `=>` operator.
`if`/`else` branches are collapsed independently, so `if (a) { x; } else { y; }`
reaches `if (a) x; else y;` over two fix passes. A separate rule unwraps an
else-block whose sole statement is an `if` (`else { if (a) … }` → `else if (a) …`);
it is the mirror image of the else-collapse rule, matching exactly the
control-flow case the others skip. `switch` clauses only collapse when the block
is the entire clause body (a single-element consequent), so fall-through cases
are left intact. `for await (…)` loops are matched but guarded out by a text
check, since the `await` token is not a captured field and would be dropped by
the rewrite.

The arrow rule matches a `JsArrowFunctionExpression` whose body is a
`JsFunctionBody` holding a single `JsReturnStatement`, and rewrites only that
body node — so the arrow's parameters, type parameters and return-type
annotation are preserved verbatim. An object-literal or sequence-expression
return is wrapped in parens (`() => ({ x: 1 })`) so the concise body isn't
re-parsed as a block or a comma expression.
