// Regression test for the line-width gate on the multiline object/array
// "may fit on one line" warnings.
//
// Those warnings are warn-only (no autofix), so the fixture harness in
// scripts/run-tests.mjs — which compares file content after `biome check --write`
// — cannot observe whether they fire. This test spawns `biome lint` directly and
// inspects the diagnostics: a definition whose non-whitespace content fits within
// the line width is warned, while one whose content alone exceeds it is not.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const ROOT = join(__dirname, "..");
const BIOME = join(ROOT, "node_modules", ".bin", "biome");
const PLUGIN = join(ROOT, "oneLiner.grit");

interface BiomeReport {
  summary?: { warnings?: number };
  diagnostics?: Array<{ message?: string }>;
}

/** Run `biome lint --reporter=json` in `cwd` on `file` and return the parsed
 *  report. Biome prints a stability notice before the JSON, so pull the first
 *  `{`-delimited document out of stdout. */
function lintJson(cwd: string, file: string): BiomeReport {
  let raw = "";
  try {
    raw = execFileSync(BIOME, ["lint", "--reporter=json", file], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    raw = (err as { stdout?: string }).stdout ?? "";
  }
  const start = raw.indexOf("{");
  if (start === -1) return {};
  return JSON.parse(raw.slice(start));
}

/** Temp dir with a biome.json that loads only the plugin (no other lint rules),
 *  matching the fixture config in tests/biome.json. */
function withPluginDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "one-liner-gate-"));
  writeFileSync(
    join(dir, "biome.json"),
    JSON.stringify({ plugins: [PLUGIN], linter: { rules: { preset: "none" } } }, null, 2),
  );
  return dir;
}

const OBJ = "This object definition spans multiple lines";
const ARR = "This array definition spans multiple lines";

describe("line-width gate on multiline definition warnings", () => {
  test("small multiline object/array are warned; oversized ones are not", () => {
    const dir = withPluginDir();
    try {
      const file = join(dir, "sample.ts");
      writeFileSync(
        file,
        [
          // Small: content fits well within the line width → warned.
          'const smallObj = {',
          '  x: 0,',
          '};',
          // Oversized: non-whitespace content alone exceeds the line width → not warned.
          'const hugeObj = {',
          '  a: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",',
          '  b: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",',
          '};',
          'const smallArr = [',
          '  1,',
          '];',
          'const hugeArr = [',
          '  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",',
          '  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",',
          '];',
          '',
        ].join("\n"),
      );

      const report = lintJson(dir, file);
      const messages = (report.diagnostics ?? []).map((d) => d.message ?? "");
      const objWarnings = messages.filter((m) => m.includes(OBJ));
      const arrWarnings = messages.filter((m) => m.includes(ARR));

      // Exactly one object warning (smallObj) and one array warning (smallArr);
      // the oversized definitions are gated out.
      expect(objWarnings).toHaveLength(1);
      expect(arrWarnings).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a multiline definition just under the width is still warned", () => {
    const dir = withPluginDir();
    try {
      const file = join(dir, "sample.ts");
      // ~104 non-whitespace chars — just under the 110-column reference, so it
      // should still be warned.
      writeFileSync(
        file,
        [
          'const nearWidth = {',
          '  key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",',
          '};',
          '',
        ].join("\n"),
      );
      const report = lintJson(dir, file);
      const messages = (report.diagnostics ?? []).map((d) => d.message ?? "");
      expect(messages.some((m) => m.includes(OBJ))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
