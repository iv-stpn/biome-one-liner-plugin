// Single-line types are not flagged.
type Id = string;
type Status = "active" | "inactive";

// Multiline types with comments are skipped.
type Documented = {
	// the id
	id: string;
};

interface Annotated {
	/* the name */
	name: string;
}
