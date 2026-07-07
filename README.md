# biome-one-liner-plugin

A [Biome](https://biomejs.dev) plugin (GritQL) that collapses single-statement
blocks into one-liners — a Biome-native port of
`offkeep/scripts/refactor-one-liners.ts`.

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

// after
if (cond) return value;
if (a) foo(); else bar();
for (const x of arr) process(x);
while (cond) doThing();
```

## What it collapses

| Construct | Transformation |
| --- | --- |
| `if (c) { stmt; }` | `if (c) stmt;` |
| `if (c) { stmt; } else …` | `if (c) stmt; else …` (else preserved) |
| `… else { stmt; }` | `… else stmt;` |
| `else if (c) { stmt; }` | `else if (c) stmt;` |
| `for (init; test; update) { stmt; }` | `for (init; test; update) stmt;` |
| `for (init of iter) { stmt; }` | `for (init of iter) stmt;` |
| `for (init in obj) { stmt; }` | `for (init in obj) stmt;` |
| `while (c) { stmt; }` | `while (c) stmt;` |

Multi-statement blocks are left untouched.

## What it deliberately leaves alone

A single-statement block is **not** collapsed when its statement:

- **is itself control flow** (`if` / `for` / `while` / `switch`) — matches the
  original script and avoids dangling-else hazards, e.g.
  `if (a) { if (b) z(); }` stays as-is;
- **is a lexical declaration** (`let` / `const` / `class` / `function`) — these
  cannot legally be the sole body of a control-flow statement, so collapsing
  them would produce a parse error. (`var` is fine and is collapsed.);
- **contains a comment** — so no documentation is silently dropped. Blocks like
  `if (a) { /* keep */ return 1; }` are preserved verbatim.

These last two are improvements over the original regex-based script, which
could emit invalid code (`if (a) const x = 1;`) and drop leading comments.

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
`for` / `for-of` / `for-in` / `while`, including `for (;;)`), plus the
non-collapsing cases: multi-statement blocks, blocks whose body is itself
control flow, `let`/`const`/`class`/`function` bodies (vs. `var`, which
collapses), blocks containing comments, and function/arrow bodies (which are
never touched).

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
`for-in` / `while` statements whose body is a `JsBlockStatement` with exactly
one statement (`statements=[$s]`), guarded by the three rules above, and
rewrites the block away via the GritQL `=>` operator. `if`/`else` branches are
collapsed independently, so `if (a) { x; } else { y; }` reaches
`if (a) x; else y;` over two fix passes.
