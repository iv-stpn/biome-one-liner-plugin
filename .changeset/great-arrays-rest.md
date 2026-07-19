---
"biome-one-liner-plugin": patch
---

Suppress the multiline-array one-liner warning when every element is a multi-key object. Such an array is a table of records, which stays clearer one-entry-per-line than collapsed into one long line. Arrays holding a single-key object, a primitive, or a spread as a direct element are still warned, as are empty multiline arrays; a single-key object nested inside a record does not re-trigger the warning.
