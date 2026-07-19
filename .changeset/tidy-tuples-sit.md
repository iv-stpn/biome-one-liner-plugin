---
"biome-one-liner-plugin": patch
---

Also suppress the multiline-array one-liner warning when every element is a multi-element array (a tuple), e.g. `[string, string][]` lookup tables. The record-table suppression now covers any record-like element — a multi-key object or a multi-element array — while arrays holding a single-key object, a single-element array, a primitive, or a spread as a direct element are still warned.
