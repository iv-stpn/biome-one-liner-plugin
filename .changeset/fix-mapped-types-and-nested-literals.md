---
"biome-one-liner-plugin": patch
---

Fix the `collapse-object-definitions` fixer so it collapses mapped type aliases
and nested multiline object/array literals, both of which were silently skipped
before.

- **Mapped type aliases** (`type Foo = { [K in keyof T]: U }`): `{ [K in keyof
  T]… }` parses as a `MappedTypeNode`, not a `TypeLiteralNode`, so the fixer's
  `isTypeLiteralNode` collector never matched it and every mapped-type alias was
  left untouched. The fixer now recognizes `MappedTypeNode` and collapses it
  (preserving `readonly`, `as` clauses, and `?`/`+?`/`-?` modifiers).
- **Nested multiline literals** (`const x = { y: { a: 1 } }`): the fixer took
  each property/element's raw text, so a nested multiline object/array left a
  newline in the joined result and the outer definition was skipped — leaving the
  diagnostic unfixed. The fixer now collapses nested multiline object/array
  literals recursively (innermost first) and splices them into the parent, so
  the outer becomes a genuine one-liner in a single pass.

Both changes preserve idempotency: a node that still cannot become a single line
(e.g. a union nested inside `Array<…>`, or a literal carrying a comment) is still
skipped.
