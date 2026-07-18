---
"biome-one-liner-plugin": patch
---

Move `@typescript/typescript6` from devDependencies to dependencies so the `collapse-object-definitions` fixer is runnable directly from a consuming project (not just from a checkout of this repo). Document the fixer — and how to invoke it — in the README.
