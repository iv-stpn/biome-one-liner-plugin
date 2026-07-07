function f(obj: Record<string, number>) {
  for (const k in obj) {
    process(k);
  }
}
