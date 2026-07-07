const empty = (x) => {
  return;
};
const cmt = (x) => {
  return x; // keep
};
const multi = (x) => {
  foo();
  return x;
};
const noret = (x) => {
  foo();
};
const already = (x) => x;
