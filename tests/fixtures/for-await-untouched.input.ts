async function f(y: AsyncIterable<number>, z: number[]) {
  for await (const x of y) {
    use(x);
  }
  for (const x of z) {
    use(x);
  }
}
