/** A point of a chart line, in pixels. */
export type Point = { x: number; y: number };

/**
 * A smooth SVG path through every point (the "monotone" curve charts use).
 * It never bends past a point, so a line between two equal values stays flat
 * and a line down to zero never dips below the baseline.
 * The points must be sorted by `x`.
 * @param pts - the points, left to right
 * @returns the `d` of an SVG path, "" for no points
 */
export function smoothPath(pts: Point[]): string {
	const n = pts.length;
	if (n === 0) return "";
	const first = pts[0]!;
	if (n === 1) return `M${first.x},${first.y}`;

	// slope of each segment
	const slopes: number[] = [];
	for (let i = 0; i < n - 1; i++) {
		const a = pts[i]!,
			b = pts[i + 1]!;
		slopes.push((b.y - a.y) / (b.x - a.x || 1));
	}

	// slope of the line at each point: 0 at a peak or a valley, else a damped mean (as d3 curveMonotoneX)
	const tangents = new Array<number>(n).fill(0);
	for (let i = 1; i < n - 1; i++) {
		const s0 = slopes[i - 1]!,
			s1 = slopes[i]!;
		if (s0 * s1 <= 0) continue;
		const h0 = pts[i]!.x - pts[i - 1]!.x,
			h1 = pts[i + 1]!.x - pts[i]!.x,
			mean = (s0 * h1 + s1 * h0) / (h0 + h1);
		tangents[i] =
			2 *
			Math.sign(s0) *
			Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(mean));
	}
	tangents[0] = n === 2 ? slopes[0]! : (3 * slopes[0]! - tangents[1]!) / 2;
	tangents[n - 1] =
		n === 2 ? slopes[0]! : (3 * slopes[n - 2]! - tangents[n - 2]!) / 2;

	let d = `M${first.x},${first.y}`;
	for (let i = 0; i < n - 1; i++) {
		const a = pts[i]!,
			b = pts[i + 1]!,
			third = (b.x - a.x) / 3;
		d += ` C${a.x + third},${a.y + third * tangents[i]!} ${b.x - third},${b.y - third * tangents[i + 1]!} ${b.x},${b.y}`;
	}
	return d;
}
