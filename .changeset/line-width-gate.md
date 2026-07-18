---
"biome-one-liner-plugin": patch
---

Gate the multiline object and array "may fit on one line" warnings on the line width. Previously these warnings fired on every multiline object/array initializer, assuming any of them could become a one-liner. They now stay silent when the definition's non-whitespace content alone exceeds the line width (110 columns), so the "may fit on one line" advice is no longer given for definitions that cannot fit.
