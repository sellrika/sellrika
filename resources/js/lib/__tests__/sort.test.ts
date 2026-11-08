import { describe, expect, test } from "bun:test";
import { ariaSort, dirOf, nextSort, sortRows } from "../sort";

describe("nextSort", () => {
	test("a new column sorts low to high", () => {
		expect(nextSort(null, "name")).toEqual({ by: "name", dir: "asc" });
		expect(nextSort({ by: "price", dir: "desc" }, "name")).toEqual({
			by: "name",
			dir: "asc",
		});
	});

	test("the same column goes asc → desc → no sort", () => {
		expect(nextSort({ by: "name", dir: "asc" }, "name")).toEqual({
			by: "name",
			dir: "desc",
		});
		expect(nextSort({ by: "name", dir: "desc" }, "name")).toBeNull();
	});
});

describe("dirOf and ariaSort", () => {
	test("the sorted column", () => {
		expect(dirOf({ by: "name", dir: "asc" }, "name")).toBe("asc");
		expect(ariaSort({ by: "name", dir: "asc" }, "name")).toBe("ascending");
		expect(dirOf({ by: "name", dir: "desc" }, "name")).toBe("desc");
		expect(ariaSort({ by: "name", dir: "desc" }, "name")).toBe("descending");
	});

	test("another column, or no sort", () => {
		expect(dirOf({ by: "name", dir: "asc" }, "price")).toBeNull();
		expect(ariaSort({ by: "name", dir: "asc" }, "price")).toBe("none");
		expect(dirOf(null, "name")).toBeNull();
		expect(ariaSort(null, "name")).toBe("none");
	});
});

describe("sortRows", () => {
	type Row = { name: string; n: number | null };
	const rows: Row[] = [
		{ name: "b", n: 2 },
		{ name: "A", n: null },
		{ name: "c", n: 1 },
	];
	/**
	 * The value of a test row.
	 * @param r - the row
	 * @param by - the column
	 * @returns its value
	 */
	function rowValue(r: Row, by: string) {
		return by === "name" ? r.name : r.n;
	}
	/**
	 * The names in list order.
	 * @param list - the rows
	 * @returns their names
	 */
	function names(list: Row[]) {
		const out: string[] = [];
		for (const r of list) out.push(r.name);
		return out;
	}

	test("no sort keeps the server's order and copies the list", () => {
		const out = sortRows(rows, null, rowValue);
		expect(names(out)).toEqual(["b", "A", "c"]);
		expect(out).not.toBe(rows);
	});

	test("text ignores case; numbers compare as numbers", () => {
		expect(names(sortRows(rows, { by: "name", dir: "asc" }, rowValue))).toEqual(
			["A", "b", "c"],
		);
		expect(
			names(sortRows(rows, { by: "name", dir: "desc" }, rowValue)),
		).toEqual(["c", "b", "A"]);
	});

	test("empty values go last both ways", () => {
		expect(names(sortRows(rows, { by: "n", dir: "asc" }, rowValue))).toEqual([
			"c",
			"b",
			"A",
		]);
		expect(names(sortRows(rows, { by: "n", dir: "desc" }, rowValue))).toEqual([
			"b",
			"c",
			"A",
		]);
	});
});
