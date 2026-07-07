function f(a: boolean) {
  if (a) {
    foo();
    bar();
  }
  while (a) {
    foo();
    bar();
  }
}
