/** A list's sort: the column and the direction (`?sort=&dir=` on the server). */
export type Sort = { by: string; dir: "asc" | "desc" };

/**
 * The sort after a click on a column header.
 * Another column → low to high; low to high → high to low; high to low → no sort.
 * @param cur - the sort now, or null
 * @param by - the clicked column
 * @returns the new sort, or null for the list's normal order
 */
export function nextSort(cur: Sort | null, by: string): Sort | null {
	if (cur?.by !== by) return { by, dir: "asc" };
	return cur.dir === "asc" ? { by, dir: "desc" } : null;
}

/**
 * The direction of one column.
 * @param cur - the sort now, or null
 * @param by - the column
 * @returns "asc" / "desc" when this column sorts the list, else null
 */
export function dirOf(cur: Sort | null, by: string) {
	return cur?.by === by ? cur.dir : null;
}

/**
 * The `aria-sort` value of a column header.
 * @param cur - the sort now, or null
 * @param by - the column
 * @returns "ascending", "descending" or "none"
 */
export function ariaSort(cur: Sort | null, by: string) {
	const dir = dirOf(cur, by);
	return dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none";
}

/** A value a list row is sorted by. null = empty: it always goes last. */
export type SortValue = string | number | boolean | null;

/**
 * A list sorted in the browser, for a page that has all its rows.
 * Text compares in the page's language, ignoring case.
 * Empty values always go last. Equal rows keep their order.
 * @param rows - the rows, as the server sent them
 * @param sort - the sort now, or null for the server's order
 * @param rowValue - the value of one row for a column
 * @returns a new sorted list (the rows are not changed)
 */
export function sortRows<T>(
	rows: readonly T[],
	sort: Sort | null,
	rowValue: (row: T, by: string) => SortValue,
): T[] {
	const list = [...rows];
	if (!sort) return list;
	const sign = sort.dir === "asc" ? 1 : -1;
	return list.sort(function compare(a, b) {
		const x = rowValue(a, sort.by);
		const y = rowValue(b, sort.by);
		if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
		if (typeof x === "string" && typeof y === "string")
			return sign * x.localeCompare(y, undefined, { sensitivity: "base" });
		return sign * (Number(x) - Number(y));
	});
}
