---
"biome-one-liner-plugin": minor
---

Add diagnostic warnings for multiline type aliases, object initializers, and array initializers that may fit on one line.

- Single-member `type Foo = { … }` declarations get a safe autofix that collapses them to one line
- Multi-member type aliases, multiline object initialisers (`const x = { … }`), and multiline array initialisers (`const x = [ … ]`) emit a warning
- New `fixers/collapse-object-definitions.ts` engine applies those collapses by running Biome diagnostics and using the TypeScript compiler to locate and rewrite flagged nodes
