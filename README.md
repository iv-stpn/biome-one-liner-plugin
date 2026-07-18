# biome-one-liner-plugin

[![npm](https://img.shields.io/npm/v/biome-one-liner-plugin.svg)](https://www.npmjs.com/package/biome-one-liner-plugin)

A [Biome](https://biomejs.dev) plugin (written in
[GritQL](https://biomejs.dev/blog/gritql-biome)) that collapses single-statement
blocks into one-liners — turning the verbose form on the left into the tidy form
on the right.

```ts
// before
if (cond) {
  return value;
}
if (a) foo();
else bar();
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
if (a) foo();
else bar();
for (const x of arr) process(x);
while (cond) doThing();
do doThing(); while (cond);
switch (x) {
  case 1:
    handle();
}
const inc = (n) => n + 1;
```

## What it collapses

| Construct                            | Transformation                                      |
| ------------------------------------ | --------------------------------------------------- |
| `if (c) { stmt; }`                   | `if (c) stmt;`                                      |
| `if (c) { stmt; } else …`            | `if (c) stmt;` + `else …` on its own line           |
| `… else { stmt; }`                   | `else stmt;` on its own line                        |
| `else if (c) { stmt; }`              | `else if (c) stmt;` on its own line                 |
| `else { if (c) … }`                  | `else if (c) …` on its own line (unwrap to else-if) |
| `for (init; test; update) { stmt; }` | `for (init; test; update) stmt;`                    |
| `for (init of iter) { stmt; }`       | `for (init of iter) stmt;`                          |
| `for (init in obj) { stmt; }`        | `for (init in obj) stmt;`                           |
| `while (c) { stmt; }`                | `while (c) stmt;`                                   |
| `do { stmt; } while (c);`            | `do stmt; while (c);`                               |
| `switch: case v: { stmt; }`          | `case v: stmt;`                                     |
| `switch: default: { stmt; }`         | `default: stmt;`                                    |
| `label: { stmt; }`                   | `label: stmt;`                                      |
| `(x) => { return expr; }`            | `(x) => expr`                                       |

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

The arrow-body collapse (`(x) => { return expr; }` → `(x) => expr`) rewrites
only the block body, so the arrow's parameters, type parameters, and return-type
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

## Collapsing multiline object/array/type definitions

Beyond control-flow blocks, the plugin also flags multiline definitions that
read fine on a single line:

```ts
// before
type Point = {
  x: number;
};

const config = {
  enabled: true,
};

const flags = [
  "a",
];

// after
type Point = { x: number };
const config = { enabled: true };
const flags = ["a"];
```

The plugin only **warns** on these — `biome lint --write` leaves them multiline.
The "after" form above is produced by the `collapse-object-definitions` fixer
described below.

What gets warned, and what gets fixed automatically:

| Construct                          | Diagnostic                                                    | Auto-fixed by Biome?                       |
| ---------------------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| `type Foo = { … }` (any members)   | "This type alias spans multiple lines and may fit on one line." | No — warn only.                         |
| `const x = { … }` (object)         | "This object definition spans multiple lines and may fit on one line." | No — warn only.                  |
| `const x = [ … ]` (array)          | "This array definition spans multiple lines and may fit on one line." | No — warn only.                     |

None of these definitions have a GritQL rewrite, so none are applied by
`biome lint --write` — single- and multi-member type aliases are treated the
same. The warnings are gated on a line-width check (the collapsed one-liner must
plausibly fit within **110 columns** — see the `fits_on_one_line` guard in
[oneLiner.grit](oneLiner.grit)), so a definition whose own content already
exceeds the line width stays silent. As with blocks, any definition containing a
comment is left untouched so nothing is silently dropped.

### The `collapse-object-definitions` fixer

Because the warnings above have no GritQL rewrite, `biome lint --write` leaves
every one of them in place. A separate fixer script closes that gap. It re-runs
Biome to collect the plugin's diagnostics, then uses the TypeScript compiler to
locate each flagged node, join its members/elements onto a single line, and
replace its text with a collapsed one-liner. It is **idempotent** — an
already-collapsed site no longer emits the diagnostic, so re-running is a no-op.

The fixer lives in [fixers/collapse-object-definitions.ts](fixers/collapse-object-definitions.ts)
and is shipped with the package (its `@typescript/typescript6` dependency is
installed alongside the plugin), so consumers can run it directly. Invoke it
through `bun`, pointing it at the files you want to fix:

```sh
# from your project (with biome-one-liner-plugin installed)
bun run node_modules/biome-one-liner-plugin/fixers/collapse-object-definitions.ts [paths...]
# or, in a checkout of this repo:
npm run fixer:object-defs -- [paths...]
```

Flags:

- `--dry-run` — show what would change without writing.
- `--help` / `-h` — print usage.

Paths default to the current directory. Run it **after** `biome check --write`
so the plugin's own safe fixes (block collapses) apply first, leaving the fixer
to handle the warn-only definitions.

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

Without `--write`, the plugin only reports diagnostics (severity `warn`, code
`plugin`), so you can review before applying.

`biome lint --write` applies only the plugin's safe GritQL fixes (block
collapses). Multiline object/array/type definitions are warn-only in the plugin,
so to collapse them run the
[`collapse-object-definitions` fixer](#the-collapse-object-definitions-fixer)
afterwards:

```sh
npx @biomejs/biome lint --write <files>
bun run node_modules/biome-one-liner-plugin/fixers/collapse-object-definitions.ts <files>
```

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
runner ([scripts/run-tests.mjs](scripts/run-tests.mjs)) runs `biome lint --write` on each input
with only the plugin enabled (no other lint rules) and compares against the
expected output.

```sh
npm test
```

Covered cases include every collapsed construct (`if` / `else if` / `else` /
`for` / `for-of` / `for-in` / `while` / `do-while` / `switch` case & default /
labeled block / `else { if … }` → `else if …`, including `for (;;)`, plus the
arrow-body collapse with object/sequence wrapping), and the non-collapsing
cases: multi-statement blocks, blocks whose body is itself control flow,
`let`/`const`/`class`/`function` bodies (vs. `var`, which collapses), blocks
containing comments, `function` declaration bodies (which are never touched),
fall-through `switch` cases and `case`/`default` blocks holding a lexical
declaration (which would leak scope across the switch), labeled loops (whose
`break`/`continue` target is preserved), `for await` loops (whose `await` cannot
be re-emitted), and arrow bodies that can't collapse (empty `return;`, comments,
multi-statement).

## Releasing

Versions and the changelog are managed with
[Changesets](https://github.com/changesets/changesets).

1. Add a changeset describing a change: `npx changeset`.
2. Commit the changeset to your branch.
3. On merge to `main`, the [Release workflow](.github/workflows/release.yml)
   opens a "Version Packages" pull request that bumps the version and updates
   `CHANGELOG.md`.
4. Merge that PR and the workflow publishes the new version to npm.

The workflow needs an `NPM_TOKEN` secret in the repo (an npm
[automation access token](https://docs.npmjs.com/creating-and-viewing-access-tokens)).
Add it under **Settings → Secrets and variables → Actions**. CI runs the test
suite on every push and pull request
([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## How it works

The plugin is one Biome plugin file. It matches `if` / `for` / `for-of` /
`for-in` / `while` / `do-while` statements, `switch` `case`/`default` clauses,
and labeled statements whose body is a `JsBlockStatement` with exactly one
statement (`statements=[$s]`), guarded by the three shared patterns
(`control_flow_statement`, `lexical_declaration`, `has_comment`) defined at the
top of the file, and rewrites the block away via the GritQL `=>` operator.
`if`/`else` branches are collapsed independently, so `if (a) { x; } else { y; }`
reaches `if (a) x;` / `else y;` over two fix passes, with the `else` emitted on
its own line so each branch reads on a separate line (the fix itself inserts the
line break, independent of the formatter). A separate rule unwraps an else-block
whose sole statement is an `if` (`else { if (a) … }` → `else if (a) …`); it is
the mirror image of the else-collapse rule, matching exactly the control-flow
case the others skip. `switch` clauses only collapse when the block is the
entire clause body (a single-element consequent), so fall-through cases are left
intact. `for await (…)` loops are matched but guarded out by a text check, since
the `await` token is not a captured field and would be dropped by the rewrite.

The arrow rule matches a `JsArrowFunctionExpression` whose body is a
`JsFunctionBody` holding a single `JsReturnStatement`, and rewrites only that
body node — so the arrow's parameters, type parameters and return-type
annotation are preserved verbatim. An object-literal or sequence-expression
return is wrapped in parens (`() => ({ x: 1 })`) so the concise body isn't
re-parsed as a block or a comma expression.
