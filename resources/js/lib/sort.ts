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
