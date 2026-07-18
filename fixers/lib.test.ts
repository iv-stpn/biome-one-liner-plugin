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

  test("multi-member type alias → skipped, source unchanged (no members dropped)", () => {
    // Regression: the fixer used to collapse this to the first member only,
    // silently dropping every member after it. It must leave it intact.
    const src = `${PREFIX}type Point = {\n  x: number;\n  y: number;\n};\n`;
    expect(run(src, ["type Point"])).toBe(src);
  });

  test("multi-member generic type alias → skipped, source unchanged", () => {
    const src = `${PREFIX}type Choice<T> = {\n  a: T;\n  b: string;\n  c: number;\n};\n`;
    expect(run(src, ["type Choice"])).toBe(src);
  });
});

describe("object definition collapse", () => {
  test("single-property object initializer → only the initializer replaced", () => {
    const src = `const x = {\n  key: "val",\n};\n`;
    // offset at "x" (start of VariableDeclaration); edit targets the ObjectLiteralExpression only
    expect(run(src, ["x = "])).toBe(`const x = { key: "val" };\n`);
  });

  test("multi-property object → skipped, source unchanged", () => {
    const src = `const p = {\n  x: 0,\n  y: 1,\n};\n`;
    expect(run(src, ["p = "])).toBe(src);
  });
});

describe("array definition collapse", () => {
  test("single-element array initializer → only the initializer replaced", () => {
    const src = `const ids = [\n  1,\n];\n`;
    expect(run(src, ["ids = "])).toBe(`const ids = [1];\n`);
  });

  test("multi-element array → skipped, source unchanged", () => {
    const src = `const pairs = [\n  "a",\n  "b",\n];\n`;
    expect(run(src, ["pairs = "])).toBe(src);
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
