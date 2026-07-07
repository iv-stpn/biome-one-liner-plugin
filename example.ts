// Example input for the one-liner plugin.
// Run: npx @biomejs/biome lint --write example.ts
function example(a: boolean, arr: number[]) {
  if (a) {
    return 1;
  }
  if (a) {
    foo();
    bar();
  }
  if (a) { return 2; } else { return 3; }
  if (a) { foo(); } else if (b) { bar(); } else { baz(); }
  for (const x of arr) {
    process(x);
  }
  while (a) {
    doThing();
  }
  do {
    doThing();
  } while (a);
  switch (arr.length) {
    case 0: {
      return;
    }
    default: {
      process(arr[0]);
    }
  }
  outer: {
    doThing();
  }
}
const inc = (n: number) => {
  return n + 1;
};
const makePoint = (x: number, y: number) => {
  return { x, y };
};
