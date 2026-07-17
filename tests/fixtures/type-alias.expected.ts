// Multiline type aliases — each should be flagged as a warning.
type Point = {
	x: number;
	y: number;
};

type Direction = "north" | "south" | "east" | "west";

interface Size {
	width: number;
	height: number;
}

// Single-member type alias — should be collapsed to one line.
type HeaderContextValue = { closeButtonAccessory: React.ReactNode | null };
