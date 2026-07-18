// Unit tests for the collapse-object-definitions fixer's pure transform.
// Run with: bun test fixers/lib.test.ts
//
// These cover planFileEdits — the function that turns Biome-reported spans into
// scope-aware, comment-safe collapses — without spawning Biome.
// Each case supplies offsets the way runFixer does from Biome's diagnostics
// (position of the flagged node's first token), located from the source via a
// marker substring so each case stays readable.
import { describe, expect, test } from "bun:test";
import { planFileEdits } from "./lib.ts";

// Offsets of the nodes to collapse in `source`, found the way Biome reports
// them: the position of the first token of each flagged node.
// We locate them by a marker substring so each case stays readable.
function offsetsOf(source: string, markers: readonly string[]): number[] {
  return markers.map((m) => {
    const at = source.indexOf(m);
    if (at === -1) throw new Error(`marker not found: ${m}`);
    return at;
  });
}

// Run planFileEdits against the nodes identified by `markers`.
function run(source: string, markers: readonly string[]): string {
  return planFileEdits("test.ts", source, offsetsOf(source, markers)).output;
}

// nodeStartingAt uses a DFS that matches the first node whose getStart() equals
// the supplied offset. Because the SourceFile root's getStart() is 0, any
// declaration at offset 0 would be shadowed by it. In practice Biome-analysed
// files always have leading imports, so top-level declarations are never at
// offset 0. Each test below mirrors that by prefixing a short sentinel line
// (`const _ = 0;`) that pushes the type alias off position 0.
const PREFIX = `const _ = 0;\n`; // 13 chars — type aliases start at offset 13

describe("type alias collapse", () => {
  test("single-member type alias → collapsed to one line", () => {
    const src = `${PREFIX}type Foo = {\n  bar: string;\n};\n`;
    expect(run(src, ["type Foo"])).toBe(`${PREFIX}type Foo = { bar: string };\n`);
  });

  test("single-member generic type alias → type params preserved", () => {
    const src = `${PREFIX}type Wrapper<T> = {\n  value: T;\n};\n`;
    expect(run(src, ["type Wrapper"])).toBe(`${PREFIX}type Wrapper<T> = { value: T };\n`);
  });

  test("two single-member type aliases in one pass → both collapsed", () => {
    const src = `${PREFIX}type A = {\n  p: number;\n};\ntype B = {\n  q: string;\n};\n`;
    expect(run(src, ["type A", "type B"])).toBe(`${PREFIX}type A = { p: number };\ntype B = { q: string };\n`);
  });

  test("multi-member type alias → all members joined onto one line (none dropped)", () => {
    // Regression: the fixer used to skip multi-member aliases, leaving the
    // diagnostic unfixed. It now joins every member so nothing is dropped.
    const src = `${PREFIX}type Point = {\n  x: number;\n  y: number;\n};\n`;
    expect(run(src, ["type Point"])).toBe(`${PREFIX}type Point = { x: number; y: number };\n`);
  });

  test("multi-member generic type alias → all members joined, type params preserved", () => {
    const src = `${PREFIX}type Choice<T> = {\n  a: T;\n  b: string;\n  c: number;\n};\n`;
    expect(run(src, ["type Choice"])).toBe(`${PREFIX}type Choice<T> = { a: T; b: string; c: number };\n`);
  });

  test("member that is itself multiline → skipped (collapse would not be a one-liner)", () => {
    // A single-member alias whose member spans multiple lines (e.g. a union
    // nested in Array<…>) cannot become a genuine one-liner by collapsing the
    // outer braces. It must be skipped so the fixer stays idempotent.
    const src = `${PREFIX}type Result = {\n  data: Array<\n    | { ok: true }\n    | { ok: false }\n  >;\n};\n`;
    expect(run(src, ["type Result"])).toBe(src);
  });

  test("exported type alias → collapsed, `export` preserved", () => {
    // Regression: Biome reports the span at the `type` keyword (after `export`),
    // but TS's TypeAliasDeclaration.getStart() returns the `export` position, so
    // an exact-start match found nothing and every exported alias was skipped.
    const src = `${PREFIX}export type ShareLinkFileKey = {\n  wrappedFileKey: string;\n  wrappedFileKeyNonce: string;\n};\n`;
    expect(run(src, ["type ShareLinkFileKey"])).toBe(
      `${PREFIX}export type ShareLinkFileKey = { wrappedFileKey: string; wrappedFileKeyNonce: string };\n`,
    );
  });

  test("intersection type alias → only the literal collapsed, `&` member preserved", () => {
    // Regression: node.type is an IntersectionType, not a TypeLiteral, so the
    // old `!isTypeLiteralNode(type)` guard skipped these entirely.
    const src = `${PREFIX}export type OrganizationInviteForRecipient = OrganizationInvite & {\n  organizationName: string;\n};\n`;
    expect(run(src, ["type OrganizationInviteForRecipient"])).toBe(
      `${PREFIX}export type OrganizationInviteForRecipient = OrganizationInvite & { organizationName: string };\n`,
    );
  });

  test("union type alias → only the literal collapsed, `|` members preserved", () => {
    const src = `${PREFIX}type Result = Ok | {\n  error: string;\n  code: number;\n};\n`;
    expect(run(src, ["type Result"])).toBe(`${PREFIX}type Result = Ok | { error: string; code: number };\n`);
  });

  test("mapped type alias → collapsed to one line (mapped types are not type literals)", () => {
    // Regression: `{ [K in keyof T]?: U }` parses as a MappedTypeNode, not a
    // TypeLiteralNode, so the old `isTypeLiteralNode` collector skipped every
    // mapped-type alias — leaving the diagnostic unfixed.
    const src = `${PREFIX}type MotiStyle = {\n  [K in keyof BaseStyle]?: BaseStyle[K] | BaseStyle[K][];\n};\n`;
    expect(run(src, ["type MotiStyle"])).toBe(
      `${PREFIX}type MotiStyle = { [K in keyof BaseStyle]?: BaseStyle[K] | BaseStyle[K][] };\n`,
    );
  });

  test("mapped type alias in an intersection → only the mapped block collapsed", () => {
    const src = `${PREFIX}type MotiTransition<Animate = MotiStyle> = MotiTransitionConfig & {\n  [K in keyof Animate]?: MotiTransitionConfig;\n};\n`;
    expect(run(src, ["type MotiTransition"])).toBe(
      `${PREFIX}type MotiTransition<Animate = MotiStyle> = MotiTransitionConfig & { [K in keyof Animate]?: MotiTransitionConfig };\n`,
    );
  });

  test("readonly mapped type with `as` clause → modifiers and clause preserved on one line", () => {
    const src = `${PREFIX}type Getters<T> = {\n  readonly [K in keyof T as \`get\${Capitalize<K>}\`]: () => T[K];\n};\n`;
    expect(run(src, ["type Getters"])).toBe(
      `${PREFIX}type Getters<T> = { readonly [K in keyof T as \`get\${Capitalize<K>}\`]: () => T[K] };\n`,
    );
  });

  test("nested multiline type literal → collapsed recursively in one pass", () => {
    const src = `${PREFIX}type Nested = {\n  outer: {\n    inner: number;\n  };\n};\n`;
    expect(run(src, ["type Nested"])).toBe(`${PREFIX}type Nested = { outer: { inner: number } };\n`);
  });
});

describe("object definition collapse", () => {
  test("single-property object initializer → only the initializer replaced", () => {
    const src = `const x = {\n  key: "val",\n};\n`;
    // offset at "x" (start of VariableDeclaration); edit targets the ObjectLiteralExpression only
    expect(run(src, ["x = "])).toBe(`const x = { key: "val" };\n`);
  });

  test("multi-property object → all properties joined onto one line", () => {
    const src = `const p = {\n  x: 0,\n  y: 1,\n};\n`;
    expect(run(src, ["p = "])).toBe(`const p = { x: 0, y: 1 };\n`);
  });

  test("nested multiline object literal → collapsed recursively (outer becomes a one-liner)", () => {
    // Regression: the fixer used to take each property's raw text, so a nested
    // multiline object left a newline in the joined result and the outer was
    // skipped — leaving the diagnostic unfixed. It now collapses the inner
    // first and splices it in, so the outer becomes a genuine one-liner.
    const src = `const nested = {\n  inner: {\n    a: 0,\n    b: 1,\n  },\n};\n`;
    expect(run(src, ["nested = "])).toBe(`const nested = { inner: { a: 0, b: 1 } };\n`);
  });

  test("nested multiline array literal → collapsed recursively", () => {
    const src = `const matrix = {\n  rows: [\n    [1, 2],\n    [3, 4],\n  ],\n};\n`;
    expect(run(src, ["matrix = "])).toBe(`const matrix = { rows: [[1, 2], [3, 4]] };\n`);
  });

  test("nested multiline object inside a call-argument value → collapsed recursively", () => {
    const src = `const cfg = {\n  headers: build({\n    a: 1,\n    b: 2,\n  }),\n};\n`;
    expect(run(src, ["cfg = "])).toBe(`const cfg = { headers: build({ a: 1, b: 2 }) };\n`);
  });

  test("nested object with a comment → whole outer skipped (no documentation dropped)", () => {
    const src = `const nested = {\n  inner: {\n    // keep\n    a: 0,\n  },\n};\n`;
    expect(run(src, ["nested = "])).toBe(src);
  });

  test("property whose value is a method → skipped (multiline body is not collapsible)", () => {
    const src = `const obj = {\n  fn() {\n    return 1;\n  },\n};\n`;
    expect(run(src, ["obj = "])).toBe(src);
  });
});

describe("array definition collapse", () => {
  test("single-element array initializer → only the initializer replaced", () => {
    const src = `const ids = [\n  1,\n];\n`;
    expect(run(src, ["ids = "])).toBe(`const ids = [1];\n`);
  });

  test("multi-element array → all elements joined onto one line", () => {
    const src = `const pairs = [\n  "a",\n  "b",\n];\n`;
    expect(run(src, ["pairs = "])).toBe(`const pairs = ["a", "b"];\n`);
  });
});

describe("comment guard", () => {
  test("object with line comment → skipped so no documentation is dropped", () => {
    const src = `const c = {\n  // note\n  x: 0,\n};\n`;
    expect(run(src, ["c = "])).toBe(src);
  });

  test("type alias with block comment → skipped so no documentation is dropped", () => {
    const src = `${PREFIX}type Doc = {\n  /* the id */\n  id: string;\n};\n`;
    expect(run(src, ["type Doc"])).toBe(src);
  });

  test("leading comment above a declaration → still collapsed (comment is outside the replaced region)", () => {
    // Regression: the guard used to inspect getFullText(), which includes leading
    // trivia, so any declaration preceded by a `//` comment was skipped — even
    // though the comment is never touched by the collapse. It now inspects only
    // the replaced slice, so a preceding comment no longer blocks the fix.
    const src = `// the prices\nconst prices = {\n  usd: 1,\n  eur: 0.9,\n};\n`;
    expect(run(src, ["prices = "])).toBe(`// the prices\nconst prices = { usd: 1, eur: 0.9 };\n`);
  });
});

describe("no-op safety", () => {
  test("no offsets → source unchanged", () => {
    const src = `type Named = { z: number };\n`;
    expect(planFileEdits("test.ts", src, []).output).toBe(src);
  });

  test("offset that resolves to a non-object/array variable → skipped", () => {
    const src = `const x = 1;\n`;
    // offset at "x" (VariableDeclaration), but initializer is a NumericLiteral — not collapsible
    expect(planFileEdits("test.ts", src, [6]).output).toBe(src);
  });

  test("offset at a non-TypeLiteral type alias → skipped", () => {
    const src = `${PREFIX}type Status =\n  | "active"\n  | "inactive";\n`;
    expect(run(src, ["type Status"])).toBe(src);
  });
});
