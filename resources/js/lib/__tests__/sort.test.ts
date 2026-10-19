import { describe, expect, test } from "bun:test";
import { ariaSort, dirOf, nextSort } from "../sort";

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
