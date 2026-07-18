// Shared engine for the collapse-object-definitions fixer.
//
// The GritQL rules for multiline type aliases, interfaces, object initializers,
// and array initializers are diagnostic-only for multi-member nodes (no GritQL
// rewrite). This engine applies those collapses: it runs Biome to collect the
// plugin's diagnostics, then uses the TypeScript compiler to locate each flagged
// node, join its members/elements onto a single line, and replace its text with
// the collapsed one-liner.
//
// Run via the sibling entry script (collapse-object-definitions.ts).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import ts from "@typescript/typescript6";

/** A 1-based line/column position, as reported by Biome's JSON reporter. */
interface Pos {
  line: number;
  column: number;
}

/** A resolved text edit: replace [start, end) with text. */
interface Edit {
  start: number;
  end: number;
  text: string;
  seq: number;
}

// ---------------------------------------------------------------------------
// Biome runner (locate the binary + parse the JSON report)
// ---------------------------------------------------------------------------

/** Locate the Biome binary the consumer already has installed. Prefer the local
 *  node_modules/.bin; fall back to a bare `biome` on PATH. */
function resolveBiome(): string {
  const local = join(process.cwd(), "node_modules", ".bin", "biome");
  return existsSync(local) ? local : "biome";
}

/** One diagnostic from `biome lint --reporter=json`. */
interface BiomeDiagnostic {
  category?: string;
  message?: string;
  location?: { path?: string; start?: Pos; end?: Pos };
}

/** Run `biome lint --reporter=json` on the given paths and return the parsed
 *  report. Biome exits non-zero whenever any diagnostic is emitted, so capture
 *  stdout regardless of exit code. */
export function runBiome(paths: readonly string[]): { diagnostics?: BiomeDiagnostic[] } {
  const biome = resolveBiome();
  let raw = "";
  try {
    raw = execFileSync(biome, ["lint", "--reporter=json", ...paths], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    raw = (err as { stdout?: string }).stdout ?? "";
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    process.stderr.write("fixer: could not parse Biome JSON output.\n");
    process.exit(1);
  }
}

/** Convert a 1-based {line, column} into a 0-based string offset for `source`.
 *  Biome columns count UTF-16 code units from 1, matching JS string indexing. */
export function toOffset(source: string, pos: Pos): number {
  let line = 1;
  let offset = 0;
  while (line < pos.line) {
    const nl = source.indexOf("\n", offset);
    if (nl === -1) return source.length;
    offset = nl + 1;
    line++;
  }
  return offset + (pos.column - 1);
}

// ---------------------------------------------------------------------------
// TypeScript-compiler transform (turn reported spans into collapse edits)
// ---------------------------------------------------------------------------

/** Pick the script kind so `.tsx` parses JSX and `.ts` doesn't. */
function scriptKind(fileName: string): ts.ScriptKind {
  return fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** Apply non-overlapping edits right-to-left so earlier offsets stay valid. */
function applyEdits(source: string, edits: readonly Edit[]): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end || b.seq - a.seq);
  let out = source;
  for (const edit of ordered) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}

/** Walk the AST and find a node that starts at exactly `offset`. Returns the
 *  first node found via DFS whose getStart() equals the offset. */
function nodeStartingAt(sf: ts.SourceFile, offset: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    const start = node.getStart(sf);
    if (start === offset) {
      found = node;
      return;
    }
    // Prune subtrees that cannot contain the offset.
    if (start > offset || node.getEnd() < offset) return;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Strip leading/trailing whitespace and a single trailing semicolon (for
 *  TypeScript type members, which carry their own semicolons). */
function trimMember(text: string): string {
  return text.trim().replace(/;$/, "");
}

/** Result of rewriting one source file. */
export interface PlanResult {
  /** The rewritten source (identical to input when `count` is 0). */
  output: string;
  /** Number of definitions collapsed. */
  count: number;
}

/**
 * Rewrite one TypeScript source, given the offsets Biome reported for this file
 * (each the start of a flagged node). PURE — takes offsets, not Biome — so it
 * is unit-testable without spawning the linter.
 *
 * For each offset it locates the AST node and collapses it to a one-liner,
 * joining every member/element (not just the first) so nothing is dropped:
 *
 *   type Foo = {\n  a: T\n  b: U\n}   →  type Foo = { a: T; b: U }
 *   const x = {\n  k: v\n  k2: v2\n}  →  const x = { k: v, k2: v2 }
 *   const x = [\n  a\n  b\n]          →  const x = [a, b]
 *
 * A collapse is only emitted when the result is a genuine single line. A node
 * whose member/element is itself multiline (e.g. a union nested inside
 * `Array<…>`) yields a collapsed text that still spans multiple lines; rewriting
 * its outer braces would not silence the diagnostic and would make the fixer
 * non-idempotent (re-"fixing" the same site every run). Such nodes are skipped.
 *
 * Nodes whose text contains a comment are also skipped so no documentation is
 * silently dropped.
 */
export function planFileEdits(fileName: string, source: string, offsets: readonly number[]): PlanResult {
  if (offsets.length === 0) return { output: source, count: 0 };
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, scriptKind(fileName));

  const edits: Edit[] = [];
  let seq = 0;

  for (const offset of [...offsets].sort((a, b) => a - b)) {
    const node = nodeStartingAt(sf, offset);
    if (node === undefined) continue;

    let editStart: number;
    let editEnd: number;
    let collapsed: string | undefined;
    // The exact source slice that will be replaced, so the comment guard below
    // only flags comments that would actually be dropped — not leading trivia
    // (a `//` line above the declaration) which the edit never touches.
    let replaced: string | undefined;

    if (ts.isTypeAliasDeclaration(node)) {
      const type = node.type;
      if (!ts.isTypeLiteralNode(type)) continue;
      // An empty type literal `{}` is already a one-liner; nothing to collapse.
      if (type.members.length === 0) continue;

      const members = type.members.map((m) => trimMember(m.getText(sf)));
      const name = node.name.text;
      const tparams = node.typeParameters ? `<${node.typeParameters.map((p) => p.getText(sf)).join(", ")}>` : "";
      editStart = node.getStart(sf);
      editEnd = node.getEnd();
      replaced = node.getText(sf);
      collapsed = `type ${name}${tparams} = { ${members.join("; ")} };`;
    } else if (ts.isVariableDeclaration(node)) {
      const init = node.initializer;
      if (init === undefined) continue;

      // The edit rewrites only the initializer, so guard against comments inside
      // it (a comment in the type annotation or preceding the declarator is left
      // untouched and must not block the collapse).
      replaced = init.getText(sf);
      if (ts.isObjectLiteralExpression(init)) {
        if (init.properties.length === 0) continue;
        const props = init.properties.map((p) => p.getText(sf).trim());
        editStart = init.getStart(sf);
        editEnd = init.getEnd();
        collapsed = `{ ${props.join(", ")} }`;
      } else if (ts.isArrayLiteralExpression(init)) {
        if (init.elements.length === 0) continue;
        const elems = init.elements.map((e) => e.getText(sf).trim());
        editStart = init.getStart(sf);
        editEnd = init.getEnd();
        collapsed = `[${elems.join(", ")}]`;
      } else continue;
    } else continue;

    // Defensive: skip when the replaced region carries a comment, so no
    // documentation is silently dropped.
    if (replaced === undefined || replaced.includes("//") || replaced.includes("/*")) continue;

    // Only emit when the result is a genuine one-liner. A member/element that is
    // itself multiline leaves a newline in the joined text; collapsing the outer
    // braces wouldn't silence the diagnostic and would make the fixer re-"fix"
    // the same site on every run (non-idempotent). Skip those.
    if (collapsed === undefined || collapsed.includes("\n")) continue;

    edits.push({ start: editStart, end: editEnd, text: collapsed, seq: seq++ });
  }

  if (edits.length === 0) return { output: source, count: 0 };
  return { output: applyEdits(source, edits), count: edits.length };
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

/** Configuration for the fixer CLI entry point. */
export interface FixerConfig {
  /** Human name shown in usage/output ("multiline object/array/type definitions"). */
  label: string;
  /** Script basename for the usage line ("collapse-object-definitions.ts"). */
  scriptName: string;
}

/** Message substrings that identify this fixer's target diagnostics. */
const TARGET_MESSAGES = [
  "Collapse this single-member type alias",
  "This type alias spans multiple lines",
  "This object definition spans multiple lines",
  "This array definition spans multiple lines",
] as const;

/**
 * Shared entry point for the fixer script. Runs Biome to collect the plugin's
 * diagnostics, groups reported spans by file, and rewrites each with
 * `planFileEdits`. Idempotent: an already-collapsed site no longer emits the
 * diagnostic, so re-running is a no-op.
 *
 * Flags: `--dry-run` previews without writing; `--help` prints usage. Paths
 * default to the current directory.
 */
export function runFixer(argv: readonly string[], config: FixerConfig): void {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        `Collapse single-member ${config.label} flagged by the biome-one-liner-plugin.`,
        "",
        "Usage:",
        `  bun run fixers/${config.scriptName} [paths...]`,
        "",
        "Run it after `biome check --write .`. Paths default to the current directory.",
        "",
        "Flags:",
        "  --dry-run   show what would change without writing",
        "  --help, -h  this message",
        "",
      ].join("\n"),
    );
    return;
  }

  const dryRun = argv.includes("--dry-run");
  const paths = argv.filter((a) => !a.startsWith("-"));
  if (paths.length === 0) paths.push(".");

  const report = runBiome(paths);
  const relevant = (report.diagnostics ?? []).filter(
    (d) => d.category === "plugin" && TARGET_MESSAGES.some((m) => (d.message ?? "").includes(m)),
  );

  if (relevant.length === 0) {
    process.stdout.write(`${config.scriptName}: nothing to fix.\n`);
    return;
  }

  // Group each diagnostic's start offset by file.
  const byFile = new Map<string, Pos[]>();
  for (const d of relevant) {
    const p = d.location?.path;
    const start = d.location?.start;
    if (p === undefined || start === undefined) continue;
    const list = byFile.get(p);
    if (list) list.push(start);
    else byFile.set(p, [start]);
  }

  let totalCollapsed = 0;
  let changedFiles = 0;
  for (const [file, positions] of byFile) {
    const source = readFileSync(file, "utf8");
    const offsets = positions.map((pos) => toOffset(source, pos));
    const { output, count } = planFileEdits(file, source, offsets);
    if (count === 0) continue;
    changedFiles++;
    totalCollapsed += count;
    if (dryRun) process.stdout.write(`  would fix ${count} in ${file}\n`);
    else {
      writeFileSync(file, output, "utf8");
      process.stdout.write(`  fixed ${count} in ${file}\n`);
    }
  }

  const verb = dryRun ? "would collapse" : "collapsed";
  process.stdout.write(`\n${config.scriptName}: ${verb} ${totalCollapsed} ${config.label} across ${changedFiles} file(s).\n`);
}
