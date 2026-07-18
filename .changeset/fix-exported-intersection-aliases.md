---
"biome-one-liner-plugin": patch
---

Fix the `collapse-object-definitions` fixer so it actually collapses exported and
intersection/union type aliases, which were silently skipped before.

- **Exported aliases** (`export type Foo = { … }`): Biome reports the diagnostic
  span at the `type` keyword, but the TypeScript compiler's `TypeAliasDeclaration`
  starts at the `export` keyword. The fixer's exact-start node lookup found no
  node at the reported offset, so every exported type alias was left untouched.
  The lookup now finds the declaration *containing* the offset.
- **Intersection/union aliases** (`type Foo = Bar & { … }`, `type Foo = Bar | { … }`):
  the alias's type is not a bare type literal, so the old `isTypeLiteralNode` guard
  bailed out. The fixer now collapses each multiline `{ … }` block *within* the
  alias's type, preserving `export`, the name, type parameters, and the
  intersection/union members.

The fixer is now also more surgical for plain aliases: it rewrites only the
`{ … }` block instead of reconstructing the whole declaration.
