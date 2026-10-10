import { describe, expect, test } from "bun:test";
import { smoothPath } from "../curve";

/**
 * Read the numbers of each curve piece out of a path.
 * @param d - a path made by smoothPath
 * @returns one [c1x, c1y, c2x, c2y, x, y] per piece
 */
function pieces(d: string) {
	return d
		.split(" C")
		.slice(1)
		.map((p) => p.split(/[ ,]/).map(Number));
}

describe("smoothPath", () => {
	test("empty and single point", () => {
		expect(smoothPath([])).toBe("");
		expect(smoothPath([{ x: 1, y: 2 }])).toBe("M1,2");
	});

	// an hours-like line: flat zeros (y = 100 is the baseline), a spike, back to zero
	const pts = [0, 0, 60, 10, 90, 0, 0, 40].map((v, i) => ({
		x: i * 10,
		y: 100 - v,
	}));
	const d = smoothPath(pts);

	test("goes through every point", () => {
		expect(d.startsWith("M0,100")).toBe(true);
		pieces(d).forEach((p, i) => {
			expect(p[4]).toBe(pts[i + 1]!.x);
			expect(p[5]).toBe(pts[i + 1]!.y);
		});
	});

	test("never bends past its two ends, so it never dips below the baseline", () => {
		pieces(d).forEach((p, i) => {
			const lo = Math.min(pts[i]!.y, pts[i + 1]!.y),
				hi = Math.max(pts[i]!.y, pts[i + 1]!.y);
			for (const y of [p[1]!, p[3]!]) {
				expect(y).toBeGreaterThanOrEqual(lo - 1e-9);
				expect(y).toBeLessThanOrEqual(hi + 1e-9);
			}
		});
	});
});
