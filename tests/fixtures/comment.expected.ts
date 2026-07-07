function f(a: boolean) {
	if (a) {
		/* keep me */
		return 1;
	}
	if (a) {
		return 2; // trailing
	}
	for (const x of []) {
		// process
		handle(x);
	}
}
