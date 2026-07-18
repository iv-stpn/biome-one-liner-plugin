// Shared engine for the collapse-object-definitions fixer.
//
// The GritQL rules for multiline type aliases, object initializers, and array
// initializers are diagnostic-only (no GritQL rewrite) — single- and
// multi-member nodes alike. This engine applies those collapses: it runs Biome
// to collect the plugin's diagnostics, then uses the TypeScript compiler to
// locate each flagged node, join its members/elements onto a single line, and
// replace its text with the collapsed one-liner.
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

/** Find the innermost TypeAliasDeclaration or VariableDeclaration whose
 *  [getStart, getEnd) range contains `offset`, preferring the narrowest match.
 *
 *  Biome reports the diagnostic span at the declaration's first significant
 *  token, which is not always where TypeScript's `getStart()` lands. For an
 *  `export type Foo = …` alias, Biome points at the `type` keyword while TS
 *  includes the `export` modifier in `getStart()` — so an exact-`getStart`
 *  match misses every exported alias. Containment (rather than exact start)
 *  resolves both the `export`-prefixed alias and the bare `const x = …`
 *  declarator (whose Biome span starts at the name, which TS agrees on). */
function declarationAtOffset(sf: ts.SourceFile, offset: number): ts.TypeAliasDeclaration | ts.VariableDeclaration | undefined {
  let best: ts.TypeAliasDeclaration | ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    const start = node.getStart(sf);
    const end = node.getEnd();
    // Prune subtrees that cannot contain the offset.
    if (offset < start || offset >= end) return;
    if (ts.isTypeAliasDeclaration(node) || ts.isVariableDeclaration(node)) {
      if (best === undefined || end - start < best.getEnd() - best.getStart(sf)) best = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return best;
}

/** Strip leading/trailing whitespace and a single trailing separator (`;` or
 *  `,`) — TypeScript type members carry their own separator. */
function trimMember(text: string): string {
  return text.trim().replace(/[;,]$/, "");
}

/** True when `text` carries a line or block comment, so collapsing it would
 *  silently drop documentation. (Substring check, matching the grit rule.) */
function hasComment(text: string): boolean {
  return text.includes("//") || text.includes("/*");
}

// ---------------------------------------------------------------------------
// Recursive collapse: braced blocks may nest (`{ a: { b: T } }`, an object
// literal whose property value is itself a multiline object). The diagnostic
// only flags the outermost variable declarator / type alias, so to make the
// outer a genuine one-liner we must collapse each nested multiline block first
// and splice it into the parent's text. Each helper returns the one-line text,
// or `undefined` when the result would still span lines (a member/element is
// itself multiline and not a collapsible block) or a comment would be dropped —
// propagating `undefined` skips the whole outer node, keeping the fixer
// idempotent.
// ---------------------------------------------------------------------------

/** Collapse a braced *type* block — a `TypeLiteralNode` (`{ a: T; b: U }`) or a
 *  `MappedTypeNode` (`{ [K in keyof T]?: U }`) — to one line, recursively
 *  collapsing nested multiline type blocks in its members/body. */
function collapseTypeBlock(node: ts.TypeLiteralNode | ts.MappedTypeNode, sf: ts.SourceFile): string | undefined {
  if (hasComment(node.getText(sf))) return undefined;
  if (ts.isTypeLiteralNode(node)) {
    if (node.members.length === 0) return undefined;
    const parts: string[] = [];
    for (const m of node.members) {
      const t = collapseTypeText(m, sf);
      if (t === undefined) return undefined;
      parts.push(trimMember(t));
    }
    const collapsed = `{ ${parts.join("; ")} }`;
    return collapsed.includes("\n") ? undefined : collapsed;
  }
  // MappedTypeNode: `{ [K in keyof T]?: U }` — a single clause, optionally
  // `readonly`/`+readonly`/`-readonly`, an `as Name` clause, and `?`/`+?`/`-?`.
  // Collapse is just joining the bracket, `?`, colon, and body on one line.
  // The node's text includes its own trailing `;` (verified against the TS
  // AST), so reconstructing without it leaves a clean one-liner.
  const ro = node.readonlyToken?.getText(sf);
  const tp = node.typeParameter.getText(sf);
  let nameClause = "";
  if (node.nameType) {
    const nt = collapseTypeText(node.nameType, sf);
    if (nt === undefined) return undefined;
    nameClause = ` as ${nt}`;
  }
  const q = node.questionToken?.getText(sf) ?? "";
  let body = "";
  if (node.type) {
    const bt = collapseTypeText(node.type, sf);
    if (bt === undefined) return undefined;
    body = bt;
  }
  const collapsed = `{ ${ro ? `${ro} ` : ""}[${tp}${nameClause}]${q}: ${body} }`;
  return collapsed.includes("\n") ? undefined : collapsed;
}

/** Return `node`'s text with every nested multiline type block (TypeLiteral or
 *  MappedType) spliced in as its collapsed one-liner — innermost first so each
 *  splice uses already-collapsed text. `undefined` propagates a nested block
 *  that can't collapse; a non-block newline (e.g. inside `Array<…>`) is left in
 *  the returned text for the caller to detect via `.includes("\n")`. */
function collapseTypeText(node: ts.Node, sf: ts.SourceFile): string | undefined {
  let text = node.getText(sf);
  const blocks: Array<ts.TypeLiteralNode | ts.MappedTypeNode> = [];
  const walk = (n: ts.Node): void => {
    n.forEachChild((c) => {
      if ((ts.isTypeLiteralNode(c) || ts.isMappedTypeNode(c)) && c.getText(sf).includes("\n")) blocks.push(c);
      else walk(c);
    });
  };
  walk(node);
  blocks.sort((a, b) => b.getStart(sf) - a.getStart(sf));
  for (const blk of blocks) {
    const c = collapseTypeBlock(blk, sf);
    if (c === undefined) return undefined;
    const relStart = blk.getStart(sf) - node.getStart(sf);
    const relEnd = blk.getEnd() - node.getStart(sf);
    text = text.slice(0, relStart) + c + text.slice(relEnd);
  }
  return text;
}

/** Collapse an `ObjectLiteralExpression` or `ArrayLiteralExpression` to one
 *  line, recursively collapsing nested multiline object/array literals in its
 *  properties/elements. */
function collapseLiteral(node: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression, sf: ts.SourceFile): string | undefined {
  if (hasComment(node.getText(sf))) return undefined;
  if (ts.isObjectLiteralExpression(node)) {
    if (node.properties.length === 0) return undefined;
    const parts: string[] = [];
    for (const p of node.properties) {
      const t = collapseProperty(p, sf);
      if (t === undefined) return undefined;
      parts.push(t.trim());
    }
    const collapsed = `{ ${parts.join(", ")} }`;
    return collapsed.includes("\n") ? undefined : collapsed;
  }
  if (node.elements.length === 0) return undefined;
  const parts: string[] = [];
  for (const e of node.elements) {
    const t = collapseExprValue(e, sf);
    if (t === undefined) return undefined;
    parts.push(t.trim());
  }
  const collapsed = `[${parts.join(", ")}]`;
  return collapsed.includes("\n") ? undefined : collapsed;
}

/** Reconstruct one object-literal property with its value's nested multiline
 *  literals collapsed. Method/getter/setter properties carry a multiline body
 *  and cannot become a one-liner, so they skip the whole object. */
function collapseProperty(p: ts.ObjectLiteralElementLike, sf: ts.SourceFile): string | undefined {
  if (ts.isPropertyAssignment(p)) {
    const name = collapseExprText(p.name, sf);
    if (name === undefined) return undefined;
    const val = collapseExprValue(p.initializer, sf);
    if (val === undefined) return undefined;
    return `${name}: ${val}`;
  }
  if (ts.isShorthandPropertyAssignment(p)) return collapseExprText(p.name, sf);
  if (ts.isSpreadAssignment(p)) {
    const expr = collapseExprText(p.expression, sf);
    return expr === undefined ? undefined : `...${expr}`;
  }
  return undefined; // MethodDeclaration / get / set — multiline body.
}

/** Collapse an expression-position node: a literal recurses; anything else has
 *  its nested multiline object/array literals spliced in. A literal that is
 *  already single-line is preserved verbatim. */
function collapseExprValue(node: ts.Node, sf: ts.SourceFile): string | undefined {
  if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) {
    const text = node.getText(sf);
    if (hasComment(text)) return undefined;
    return text.includes("\n") ? collapseLiteral(node, sf) : text;
  }
  return collapseExprText(node, sf);
}

/** Return `node`'s text with every nested multiline object/array literal
 *  spliced in as its collapsed one-liner (innermost first). */
function collapseExprText(node: ts.Node, sf: ts.SourceFile): string | undefined {
  let text = node.getText(sf);
  const lits: Array<ts.ObjectLiteralExpression | ts.ArrayLiteralExpression> = [];
  const walk = (n: ts.Node): void => {
    n.forEachChild((c) => {
      if ((ts.isObjectLiteralExpression(c) || ts.isArrayLiteralExpression(c)) && c.getText(sf).includes("\n")) lits.push(c);
      else walk(c);
    });
  };
  walk(node);
  lits.sort((a, b) => b.getStart(sf) - a.getStart(sf));
  for (const lit of lits) {
    const c = collapseLiteral(lit, sf);
    if (c === undefined) return undefined;
    const relStart = lit.getStart(sf) - node.getStart(sf);
    const relEnd = lit.getEnd() - node.getStart(sf);
    text = text.slice(0, relStart) + c + text.slice(relEnd);
  }
  return text;
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
 *   type Foo = {\n  a: T\n  b: U\n}            →  type Foo = { a: T; b: U }
 *   export type Bar = Foo & {\n  x: T\n}        →  export type Bar = Foo & { x: T }
 *   type Mapped<T> = {\n  [K in keyof T]?: T[K]\n}  →  type Mapped<T> = { [K in keyof T]?: T[K] }
 *   const x = {\n  k: v\n  k2: v2\n}            →  const x = { k: v, k2: v2 }
 *   const x = [\n  a\n  b\n]                    →  const x = [a, b]
 *
 * For type aliases only each multiline `{ … }` block (a type literal OR a
 * mapped type) is rewritten, so `export`, the name, type parameters, and any
 * intersection/union members are preserved — the alias need not be a bare type
 * literal. Variables rewrite only the initializer for the same reason.
 *
 * Nested multiline blocks are collapsed recursively: `const x = { y: { a: 1 } }`
 * collapses the inner object first so the outer becomes a genuine one-liner.
 *
 * A collapse is only emitted when the result is a genuine single line. A node
 * whose member/element is itself multiline AND not a collapsible block (e.g. a
 * union nested inside `Array<…>`) yields a collapsed text that still spans
 * multiple lines; rewriting its outer braces would not silence the diagnostic
 * and would make the fixer non-idempotent (re-"fixing" the same site every run).
 * Such nodes are skipped.
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
    const node = declarationAtOffset(sf, offset);
    if (node === undefined) continue;

    if (ts.isTypeAliasDeclaration(node)) {
      // Collect the OUTERMOST multiline braced type blocks within the alias's
      // type — type literals (`{ a: T }`) and mapped types (`{ [K in keyof T]:
      // U }`). Each is collapsed recursively (its own nested blocks collapse
      // with it), so we never descend into a block we're already collapsing —
      // that would produce overlapping edits. This preserves `export`, the
      // name, type params, and surrounding intersection/union members.
      const blocks: Array<ts.TypeLiteralNode | ts.MappedTypeNode> = [];
      const collect = (n: ts.Node): void => {
        if ((ts.isTypeLiteralNode(n) || ts.isMappedTypeNode(n)) && n.getText(sf).includes("\n")) {
          blocks.push(n);
          return;
        }
        ts.forEachChild(n, collect);
      };
      collect(node.type);
      for (const blk of blocks) {
        const collapsed = collapseTypeBlock(blk, sf);
        if (collapsed === undefined) continue;
        edits.push({ start: blk.getStart(sf), end: blk.getEnd(), text: collapsed, seq: seq++ });
      }
      continue;
    }

    // VariableDeclaration: collapse only the initializer (recursively), so
    // `export`/`const`/the name/any type annotation are preserved.
    const init = node.initializer;
    if (init === undefined) continue;
    if (!ts.isObjectLiteralExpression(init) && !ts.isArrayLiteralExpression(init)) continue;

    const collapsed = collapseLiteral(init, sf);
    // `undefined` or a still-multiline result means the outer can't be a
    // genuine one-liner — skip to stay idempotent (see the doc comment above).
    if (collapsed === undefined || collapsed.includes("\n")) continue;
    edits.push({ start: init.getStart(sf), end: init.getEnd(), text: collapsed, seq: seq++ });
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
