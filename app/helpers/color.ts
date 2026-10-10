/**
 * A colour as `#rrggbb`, lower case.
 * The only colour shape the app prints into a stylesheet.
 */
export const HEX_COLOR = /^#[0-9a-f]{6}$/;

/**
 * How bright one colour channel is (WCAG relative luminance).
 * @param value The channel, 0 to 255.
 * @returns The linear value, 0 to 1.
 */
function channel(value: number): number {
	const c = value / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * The text colour that reads best on a background.
 * @param hex The background, `#rrggbb`.
 * @returns Black on a light colour, white on a dark one.
 */
export function onColor(hex: string): "#000000" | "#ffffff" {
	const n = Number.parseInt(hex.slice(1), 16);
	const light =
		0.2126 * channel(n >> 16) +
		0.7152 * channel((n >> 8) & 255) +
		0.0722 * channel(n & 255);
	// the point where black and white have the same contrast
	return light > 0.179 ? "#000000" : "#ffffff";
}
