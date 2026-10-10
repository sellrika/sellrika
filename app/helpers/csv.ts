/**
 * Minimal RFC 4180 CSV.
 * Comma delimiter, `"…"` quoting with `""` escapes.
 * Rows end with `\n` or `\r\n`. A BOM at the start is optional.
 */

/**
 * Text a spreadsheet would run as a formula.
 * It starts with = + - @ tab or CR (after any quotes we added).
 */
const FORMULA = /^'*[=+\-@\t\r]/;

/** A plain number stays a number, even a negative one. */
const NUMBER = /^[-+]?\d+(\.\d+)?$/;

/**
 * Stop a spreadsheet from running a text cell as a formula.
 * It puts a `'` in front.
 * @param s The cell text.
 * @returns The text, with a `'` in front when it looks like a formula.
 */
export function guardCell(s: string): string {
	return FORMULA.test(s) && !NUMBER.test(s) ? `'${s}` : s;
}

/**
 * Undo `guardCell` when reading a file back: drop the one `'` it added.
 * @param s The cell text.
 * @returns The original text.
 */
export function unguardCell(s: string): string {
	return s.startsWith("'") && FORMULA.test(s) ? s.slice(1) : s;
}

/**
 * Write rows as CSV.
 * Text that looks like a formula gets a `'` in front (see `guardCell`).
 * @param rows The rows, header first.
 * @returns The CSV text.
 */
export function toCsv(rows: string[][]): string {
	/**
	 * Guard one cell, and quote it when it holds a quote, comma or line break.
	 * @param raw The cell text.
	 * @returns The cell as written in the file.
	 */
	function cell(raw: string) {
		const s = guardCell(raw);
		return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	}
	return `${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

/**
 * Read CSV text into rows.
 * A BOM at the start is skipped. Empty lines are left out.
 * @param text The CSV text.
 * @returns The rows, each a list of cells.
 */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	// skip BOM
	let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
	/** End the cell being read: add it to the row. */
	function pushCell() {
		row.push(cell);
		cell = "";
	}
	/** End the row being read: keep it unless it is an empty line. */
	function pushRow() {
		pushCell();
		if (row.length > 1 || row[0] !== "") rows.push(row);
		row = [];
	}
	while (i < text.length) {
		const c = text[i]!;
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					cell += '"';
					i += 2;
					continue;
				}
				quoted = false;
				i++;
				continue;
			}
			cell += c;
			i++;
			continue;
		}
		if (c === '"' && cell === "") {
			quoted = true;
			i++;
			continue;
		}
		if (c === ",") {
			pushCell();
			i++;
			continue;
		}
		if (c === "\r" || c === "\n") {
			pushRow();
			i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
			continue;
		}
		cell += c;
		i++;
	}
	if (cell !== "" || row.length) pushRow();
	return rows;
}
