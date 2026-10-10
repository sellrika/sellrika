/**
 * A small QR code maker for links: byte mode, error correction level M,
 * versions 1–20 (up to 666 bytes of text).
 * No package. Extensions get it as `api.qr()`, the slips print it.
 * It follows the QR standard (ISO 18004) the way Project Nayuki's
 * well-known reference encoder does.
 */

/** Error correction bytes per block, level M, by version (index 0 unused). */
const ECC_PER_BLOCK = [
	0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26,
	26,
];

/** How many blocks the data is split into, level M, by version. */
const BLOCKS = [
	0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
];

/** The biggest version this maker draws. */
const MAX_VERSION = 20;

/** The two format bits that say "level M". */
const LEVEL_M_BITS = 0;

/** The quiet border around a code, in modules. */
export const QR_BORDER = 4;

/** A code being drawn: its squares, and which of them are fixed patterns. */
type Grid = {
	size: number;
	dark: boolean[][];
	fixed: boolean[][];
};

/**
 * Multiply two bytes in the field QR codes use (GF(256), polynomial 0x11D).
 * @param x One byte.
 * @param y The other byte.
 * @returns The product.
 */
function multiply(x: number, y: number) {
	let z = 0;
	for (let i = 7; i >= 0; i--) {
		z = (z << 1) ^ ((z >>> 7) * 0x11d);
		z ^= ((y >>> i) & 1) * x;
	}
	return z;
}

/**
 * The Reed-Solomon divisor for a number of error correction bytes.
 * @param degree How many error correction bytes a block gets.
 * @returns The divisor's coefficients, highest power first
 * (the leading 1 left out).
 */
function divisorOf(degree: number) {
	const result = new Array<number>(degree).fill(0);
	result[degree - 1] = 1;
	let root = 1;
	for (let i = 0; i < degree; i++) {
		for (let j = 0; j < degree; j++) {
			result[j] = multiply(result[j]!, root);
			if (j + 1 < degree) result[j]! ^= result[j + 1]!;
		}
		root = multiply(root, 2);
	}
	return result;
}

/**
 * The error correction bytes of one block.
 * @param data The block's data bytes.
 * @param divisor The divisor from `divisorOf`.
 * @returns The error correction bytes.
 */
function remainderOf(data: number[], divisor: number[]) {
	const result = divisor.map(() => 0);
	for (const byte of data) {
		const factor = byte ^ result.shift()!;
		result.push(0);
		for (let i = 0; i < divisor.length; i++)
			result[i]! ^= multiply(divisor[i]!, factor);
	}
	return result;
}

/**
 * How many squares of a version carry data or error correction bits.
 * @param version The version, 1–40.
 * @returns The number of bits.
 */
function rawBits(version: number) {
	let bits = (16 * version + 128) * version + 64;
	if (version >= 2) {
		const align = Math.floor(version / 7) + 2;
		bits -= (25 * align - 10) * align - 55;
		if (version >= 7) bits -= 36;
	}
	return bits;
}

/**
 * How many data bytes a version holds at level M.
 * @param version The version.
 * @returns The number of data bytes.
 */
function dataBytes(version: number) {
	return (
		Math.floor(rawBits(version) / 8) -
		ECC_PER_BLOCK[version]! * BLOCKS[version]!
	);
}

/**
 * The text as the data bytes of a version: the mode, the length, the bytes,
 * then the end marker and padding.
 * @param bytes The text as UTF-8.
 * @param version The version.
 * @returns The data bytes, exactly as many as the version holds.
 */
function dataOf(bytes: Uint8Array, version: number) {
	const bits: number[] = [];
	/**
	 * Add a number to the bits, highest bit first.
	 * @param value The number.
	 * @param length How many bits it takes.
	 */
	function push(value: number, length: number) {
		for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
	}
	// byte mode
	push(4, 4);
	push(bytes.length, version < 10 ? 8 : 16);
	for (const b of bytes) push(b, 8);
	const capacity = dataBytes(version) * 8;
	push(0, Math.min(4, capacity - bits.length));
	push(0, (8 - (bits.length % 8)) % 8);
	for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
	const out: number[] = [];
	for (let i = 0; i < bits.length; i += 8)
		out.push(bits.slice(i, i + 8).reduce((n, bit) => (n << 1) | bit, 0));
	return out;
}

/**
 * Split the data into blocks, add each block's error correction, and
 * weave the blocks together the way the standard asks.
 * @param data The data bytes.
 * @param version The version.
 * @returns Every byte of the code, in the order they are drawn.
 */
function withCorrection(data: number[], version: number) {
	const blockCount = BLOCKS[version]!;
	const eccLength = ECC_PER_BLOCK[version]!;
	const total = Math.floor(rawBits(version) / 8);
	const shortBlocks = blockCount - (total % blockCount);
	const shortLength = Math.floor(total / blockCount);
	const divisor = divisorOf(eccLength);
	const blocks: number[][] = [];
	for (let i = 0, at = 0; i < blockCount; i++) {
		const length = shortLength - eccLength + (i < shortBlocks ? 0 : 1);
		const part = data.slice(at, at + length);
		at += length;
		const ecc = remainderOf(part, divisor);
		// a short block gets a blank so every block is the same length
		if (i < shortBlocks) part.push(0);
		blocks.push(part.concat(ecc));
	}
	const result: number[] = [];
	for (let i = 0; i < blocks[0]!.length; i++)
		for (let j = 0; j < blocks.length; j++)
			// skip the blank of the short blocks
			if (i !== shortLength - eccLength || j >= shortBlocks)
				result.push(blocks[j]![i]!);
	return result;
}

/**
 * Set one square of a fixed pattern.
 * @param g The grid.
 * @param x Column.
 * @param y Row.
 * @param dark Is it dark?
 */
function fix(g: Grid, x: number, y: number, dark: boolean) {
	g.dark[y]![x] = dark;
	g.fixed[y]![x] = true;
}

/**
 * Where the small alignment squares sit, for a version.
 * @param version The version.
 * @param size The grid size.
 * @returns The row / column positions.
 */
function alignmentPositions(version: number, size: number) {
	if (version === 1) return [];
	const count = Math.floor(version / 7) + 2;
	const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
	const result = [6];
	for (let pos = size - 7; result.length < count; pos -= step)
		result.splice(1, 0, pos);
	return result;
}

/**
 * Draw the 15 format bits (the level and the mask), twice.
 * @param g The grid.
 * @param mask The mask, 0–7.
 */
function drawFormat(g: Grid, mask: number) {
	const data = (LEVEL_M_BITS << 3) | mask;
	let rem = data;
	for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
	const bits = ((data << 10) | rem) ^ 0x5412;
	const bit = (i: number) => ((bits >>> i) & 1) !== 0;
	for (let i = 0; i <= 5; i++) fix(g, 8, i, bit(i));
	fix(g, 8, 7, bit(6));
	fix(g, 8, 8, bit(7));
	fix(g, 7, 8, bit(8));
	for (let i = 9; i < 15; i++) fix(g, 14 - i, 8, bit(i));
	for (let i = 0; i < 8; i++) fix(g, g.size - 1 - i, 8, bit(i));
	for (let i = 8; i < 15; i++) fix(g, 8, g.size - 15 + i, bit(i));
	fix(g, 8, g.size - 8, true);
}

/**
 * Draw every fixed pattern: the timing lines, the three corner squares,
 * the alignment squares, the format bits and (from version 7) the version.
 * @param g The grid.
 * @param version The version.
 */
function drawFixed(g: Grid, version: number) {
	const { size } = g;
	for (let i = 0; i < size; i++) {
		fix(g, 6, i, i % 2 === 0);
		fix(g, i, 6, i % 2 === 0);
	}
	for (const [cx, cy] of [
		[3, 3],
		[size - 4, 3],
		[3, size - 4],
	] as const)
		for (let dy = -4; dy <= 4; dy++)
			for (let dx = -4; dx <= 4; dx++) {
				const dist = Math.max(Math.abs(dx), Math.abs(dy));
				const x = cx + dx;
				const y = cy + dy;
				if (x >= 0 && x < size && y >= 0 && y < size)
					fix(g, x, y, dist !== 2 && dist !== 4);
			}
	const align = alignmentPositions(version, size);
	const last = align.length - 1;
	for (let i = 0; i <= last; i++)
		for (let j = 0; j <= last; j++) {
			// the three corners already hold the big squares
			if (
				(i === 0 && j === 0) ||
				(i === 0 && j === last) ||
				(i === last && j === 0)
			)
				continue;
			for (let dy = -2; dy <= 2; dy++)
				for (let dx = -2; dx <= 2; dx++)
					fix(
						g,
						align[i]! + dx,
						align[j]! + dy,
						Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
					);
		}
	// real bits come once the mask is picked
	drawFormat(g, 0);
	if (version < 7) return;
	let rem = version;
	for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
	const bits = (version << 12) | rem;
	for (let i = 0; i < 18; i++) {
		const dark = ((bits >>> i) & 1) !== 0;
		const a = size - 11 + (i % 3);
		const b = Math.floor(i / 3);
		fix(g, a, b, dark);
		fix(g, b, a, dark);
	}
}

/**
 * Put the bytes into the free squares, in the standard's zigzag.
 * @param g The grid.
 * @param bytes Every byte of the code.
 */
function drawData(g: Grid, bytes: number[]) {
	let i = 0;
	for (let right = g.size - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5;
		for (let vert = 0; vert < g.size; vert++)
			for (let j = 0; j < 2; j++) {
				const x = right - j;
				const upward = ((right + 1) & 2) === 0;
				const y = upward ? g.size - 1 - vert : vert;
				if (g.fixed[y]![x] || i >= bytes.length * 8) continue;
				g.dark[y]![x] = ((bytes[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
				i++;
			}
	}
}

/**
 * Does a mask flip the square at x, y?
 * @param mask The mask, 0–7.
 * @param x Column.
 * @param y Row.
 * @returns True when it flips.
 */
function masks(mask: number, x: number, y: number) {
	switch (mask) {
		case 0:
			return (x + y) % 2 === 0;
		case 1:
			return y % 2 === 0;
		case 2:
			return x % 3 === 0;
		case 3:
			return (x + y) % 3 === 0;
		case 4:
			return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
		case 5:
			return ((x * y) % 2) + ((x * y) % 3) === 0;
		case 6:
			return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
		default:
			return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
	}
}

/**
 * Flip the data squares a mask covers. Doing it twice undoes it.
 * @param g The grid.
 * @param mask The mask, 0–7.
 */
function applyMask(g: Grid, mask: number) {
	for (let y = 0; y < g.size; y++)
		for (let x = 0; x < g.size; x++)
			if (!g.fixed[y]![x] && masks(mask, x, y)) g.dark[y]![x] = !g.dark[y]![x];
}

/**
 * The finder-like run a scanner could mistake.
 * It is dark, light, 3 dark, light, dark.
 */
const FINDER = [true, false, true, true, true, false, true];

/**
 * The penalty of one row or column: long runs of one colour, and
 * finder-like runs with four light squares beside them.
 * @param line The squares of the line.
 * @returns The penalty points.
 */
function linePenalty(line: boolean[]) {
	let points = 0;
	for (let i = 1, run = 1; i <= line.length; i++) {
		if (i < line.length && line[i] === line[i - 1]) {
			run++;
			continue;
		}
		if (run >= 5) points += run - 2;
		run = 1;
	}
	// light squares past the edge count as the quiet border
	const at = (i: number) => (i >= 0 && i < line.length ? line[i]! : false);
	for (let i = 0; i + 7 <= line.length; i++) {
		if (!FINDER.every((dark, k) => at(i + k) === dark)) continue;
		const before = [1, 2, 3, 4].every((k) => !at(i - k));
		const after = [7, 8, 9, 10].every((k) => !at(i + k));
		if (before) points += 40;
		if (after) points += 40;
	}
	return points;
}

/**
 * How hard a drawn code is to scan: the standard's four penalty rules.
 * The mask with the lowest score is used.
 * @param g The grid, with a mask applied.
 * @returns The penalty points.
 */
function penalty(g: Grid) {
	const { size, dark } = g;
	let points = 0;
	let darkCount = 0;
	for (let i = 0; i < size; i++) {
		points += linePenalty(dark[i]!);
		points += linePenalty(dark.map((row) => row[i]!));
		for (let x = 0; x < size; x++) if (dark[i]![x]) darkCount++;
	}
	for (let y = 0; y < size - 1; y++)
		for (let x = 0; x < size - 1; x++) {
			const c = dark[y]![x];
			if (
				c === dark[y]![x + 1] &&
				c === dark[y + 1]![x] &&
				c === dark[y + 1]![x + 1]
			)
				points += 3;
		}
	const total = size * size;
	const k = Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1;
	return points + Math.max(0, k) * 10;
}

/**
 * Make the QR code of a text.
 * @param text What the code holds (a link).
 * @param forceMask A mask to use, 0–7. Left out, the best one is picked.
 * @returns The squares, row by row: true = dark. No border around them.
 * @throws When the text is too long for a version 20 code.
 */
export function qrCode(text: string, forceMask?: number): boolean[][] {
	const bytes = new TextEncoder().encode(text);
	let version = 1;
	while (bytes.length + (version < 10 ? 2 : 3) > dataBytes(version))
		if (++version > MAX_VERSION) throw new Error("Text too long for a QR code");
	const size = version * 4 + 17;
	const g: Grid = {
		size,
		dark: Array.from({ length: size }, () =>
			new Array<boolean>(size).fill(false),
		),
		fixed: Array.from({ length: size }, () =>
			new Array<boolean>(size).fill(false),
		),
	};
	drawFixed(g, version);
	drawData(g, withCorrection(dataOf(bytes, version), version));
	let mask = forceMask ?? 0;
	if (forceMask === undefined) {
		let best = Number.POSITIVE_INFINITY;
		for (let m = 0; m < 8; m++) {
			applyMask(g, m);
			drawFormat(g, m);
			const points = penalty(g);
			if (points < best) {
				best = points;
				mask = m;
			}
			// undo
			applyMask(g, m);
		}
	}
	applyMask(g, mask);
	drawFormat(g, mask);
	return g.dark;
}

/**
 * The code as one SVG path, with the quiet border around it.
 * Use it in `<svg viewBox="0 0 {size} {size}">` with a white background.
 * @param squares The squares from `qrCode`.
 * @returns The path data and the size of the view box.
 */
export function qrPath(squares: boolean[][]) {
	const parts: string[] = [];
	for (let y = 0; y < squares.length; y++)
		for (let x = 0; x < squares.length; x++)
			if (squares[y]![x])
				parts.push(`M${x + QR_BORDER},${y + QR_BORDER}h1v1h-1z`);
	return { d: parts.join(""), size: squares.length + QR_BORDER * 2 };
}

/**
 * A text's QR code as SVG markup.
 * Black squares on white, with the quiet border.
 * @param text What the code holds.
 * @param label The accessible name of the picture.
 * @returns The `<svg>` as a string.
 */
export function qrSvg(text: string, label = "QR code") {
	const { d, size } = qrPath(qrCode(text));
	const name = label.replace(/[<>&"]/g, "");
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${name}" shape-rendering="crispEdges" style="width:100%;height:100%;display:block"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
