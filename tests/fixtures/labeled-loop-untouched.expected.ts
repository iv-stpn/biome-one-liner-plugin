function f(arr: number[]) {
	outer: for (const x of arr) {
		if (x) break outer;
	}
}
