---
"biome-one-liner-plugin": patch
---

Internal tooling only — no change to the published `oneLiner.grit`. Run the CI
and release workflows on Bun instead of npm (the repo migrated to a `bun.lock`
lockfile), which fixes the "Dependencies lock file is not found" failure and
drops the Node 20 deprecation warning by no longer pinning `node-version`.
Restore `biome check --write` in the test runner so the formatter normalizes
fixture indentation again (it had regressed to lint-only `biome lint --write`).
