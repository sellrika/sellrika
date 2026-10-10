/**
 * Code 128 barcodes, drawn as SVG.
 * No package: the standard is one table and one checksum.
 */

/**
 * The bar and space widths of every Code 128 symbol, by value.
 * Each digit is a width in modules: bar, space, bar, space, bar, space.
 * 103 to 105 are Start A, B and C. 106 is Stop, with one bar more.
 */
export const PATTERNS = (
	"212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 " +
	"221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 " +
	"221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 " +
	"212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 " +
	"231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 " +
	"231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 " +
	"314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 " +
	"112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 " +
	"111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 " +
	"214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 " +
	"114131 311141 411131 211412 211214 211232 2331112"
).split(" ");

const START_B = 104;
const START_C = 105;
const TO_B = 100;
const STOP = 106;

/**
 * The empty space a scanner needs on each side, in modules.
 */
const QUIET = 10;

/**
 * Turn a text into Code 128 symbol values, with start, checksum and stop.
 * Digits are packed two per symbol (set C), so an EAN stays short.
 * An odd last digit, and any other text, uses set B.
 * @param text The text to encode.
 * @returns The values, or null when the text has a letter the code can't carry.
 */
export function code128(text: string): number[] | null {
	if (!/^[\x20-\x7e]+$/.test(text)) return null;
	const values: number[] = [];
	if (/^\d{4,}$/.test(text)) {
		values.push(START_C);
		const even = text.length - (text.length % 2);
		for (let i = 0; i < even; i += 2) values.push(Number(text.slice(i, i + 2)));
		if (even < text.length) values.push(TO_B, text.charCodeAt(even) - 32);
	} else {
		values.push(START_B);
		for (const ch of text) values.push(ch.charCodeAt(0) - 32);
	}
	// the start symbol counts once, every other symbol times its place
	const sum = values.reduce((n, value, i) => n + value * (i || 1), 0);
	values.push(sum % 103, STOP);
	return values;
}

/**
 * Draw a text as a Code 128 barcode.
 * The SVG stretches to the box it is put in.
 * @param text The text to encode.
 * @returns The SVG markup, or "" when the text can't be encoded.
 */
export function barcodeSvg(text: string): string {
	const values = code128(text);
	if (!values) return "";
	let x = QUIET;
	let bars = "";
	for (const value of values) {
		const widths = PATTERNS[value] ?? "";
		for (let i = 0; i < widths.length; i++) {
			const w = Number(widths[i]);
			// even places are bars, odd places are spaces
			if (i % 2 === 0) bars += `<rect x="${x}" width="${w}" height="1"/>`;
			x += w;
		}
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + QUIET} 1" preserveAspectRatio="none" shape-rendering="crispEdges" width="100%" height="100%" fill="#000">${bars}</svg>`;
}
