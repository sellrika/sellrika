import { expect, test } from "bun:test";
import { qrCode, qrPath, QR_BORDER } from "@helpers/qr";

/**
 * The squares of a code as text, one row per line.
 * @param text What the code holds.
 * @returns "#" for dark, "." for light.
 */
function drawn(text: string) {
	return qrCode(text)
		.map((row) => row.map((dark) => (dark ? "#" : ".")).join(""))
		.join("\n");
}

test("QR codes: the squares are the standard's (checked once against a reference encoder), and the SVG path has the quiet border", () => {
	// version 1, mask 2: the same squares the `qrcode` package draws for "hi" at level M
	expect(drawn("hi")).toBe(
		[
			"#######..####.#######",
			"#.....#..##.#.#.....#",
			"#.###.#.##.##.#.###.#",
			"#.###.#.##..#.#.###.#",
			"#.###.#.#..##.#.###.#",
			"#.....#.##..#.#.....#",
			"#######.#.#.#.#######",
			"........#.###........",
			"#.#####.....#.#####..",
			".###.#.#..#.#..#....#",
			"..##..##.#.#.#..####.",
			"###.#....#.....##.#..",
			"###.#.#....#.#..#.#.#",
			"........#..####..#..#",
			"#######...#.#.##...#.",
			"#.....#.#######..#..#",
			"#.###.#.#...#..#..#..",
			"#.###.#.###.#..#..#..",
			"#.###.#.#..#.#..###..",
			"#.....#..##....##.#..",
			"#######.#.##.#..####.",
		].join("\n"),
	);
	// a table link: version 6 (41 squares), several blocks, the best mask picked
	const link =
		"https://my-shop.shop.sellrika.com/?table=Table%201&t=Zq3-_x9aB7cD5eF1gH2iJ4kL6mN8oP0rS";
	expect(qrCode(link)).toHaveLength(41);
	expect(
		new Bun.CryptoHasher("sha256")
			.update(drawn(link).replaceAll("#", "1").replaceAll(".", "0"))
			.digest("hex"),
	).toBe("5c59c1cc09dd45f15f7a300c61c7d6c3d976cbcea135aa611bfc875b50f0e1e6");
	// the path: one square per dark module, moved in by the border
	const path = qrPath(qrCode("hi"));
	expect(path.size).toBe(21 + QR_BORDER * 2);
	expect(path.d.startsWith(`M${QR_BORDER},${QR_BORDER}h1v1h-1z`)).toBe(true);
	// too long for the versions it knows
	expect(() => qrCode("x".repeat(700))).toThrow();
});
