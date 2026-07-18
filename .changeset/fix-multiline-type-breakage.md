---
"biome-one-liner-plugin": patch
---

Fix the `collapse-object-definitions` fixer corrupting multi-member type aliases: it collapsed them to their first member only, silently dropping every member after it. Multi-member type aliases are now left intact (warned, not rewritten), matching how multi-property object and multi-element array initializers were already handled. Also gate the multi-member type-alias "may fit on one line" warning on the line width (non-whitespace columns summed across every line of the node), so a definition whose own content exceeds the line width — e.g. a large `type ChoiceTabProps<…> = { … }` — no longer triggers a warning.
