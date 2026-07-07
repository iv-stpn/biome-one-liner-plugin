// Test harness for the one-liner plugin.
//
// For every fixture in tests/fixtures/<name>.input.ts, copies the input into a
// temporary file (so the test-only biome.json applies), runs
// `biome lint --write` with only the plugin enabled, and compares the result
// to tests/fixtures/<name>.expected.ts.
//
// Run with: node scripts/run-tests.mjs
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TESTS = join(ROOT, "tests");
const FIXTURES = join(TESTS, "fixtures");
const TMP = join(TESTS, ".tmp");
const BIOME = join(ROOT, "node_modules", ".bin", "biome");

const failures = [];
let count = 0;

mkdirSync(TMP, { recursive: true });

const cases = readdirSync(FIXTURES)
	.filter((f) => f.endsWith(".input.ts"))
	.map((f) => f.slice(0, -".input.ts".length))
	.sort();

for (const name of cases) {
	count++;
	const input = readFileSync(join(FIXTURES, `${name}.input.ts`), "utf8");
	const expected = readFileSync(join(FIXTURES, `${name}.expected.ts`), "utf8");

	const tmpFile = join(TMP, `${name}.ts`);
	writeFileSync(tmpFile, input, "utf8");

	try {
		// `check --write` applies lint fixes (the plugin's safe fixes) and formats.
		// Ignore the exit code: biome returns non-zero when any diagnostic was
		// emitted, even one that was fixed. We only care about the file content.
		execFileSync(BIOME, ["check", "--write", tmpFile], {
			cwd: TESTS,
			stdio: "pipe",
		});
	} catch {
		// diagnostics emitted — file may still have been written; continue
	}

	const actual = readFileSync(tmpFile, "utf8");
	if (actual === expected) console.log(`  ✓ ${name}`);
	else {
		failures.push(name);
		console.log(`  ✗ ${name}`);
		console.log("    --- expected ---");
		for (const line of expected.split("\n")) console.log(`    | ${line}`);
		console.log("    --- actual ---");
		for (const line of actual.split("\n")) console.log(`    | ${line}`);
	}
}

rmSync(TMP, { recursive: true, force: true });

console.log(
	`\n${failures.length === 0 ? "all passing" : `${failures.length} failing`}: ${count - failures.length}/${count} cases`,
);
process.exit(failures.length === 0 ? 0 : 1);
