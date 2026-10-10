import { expect, test } from "bun:test";
import { Paginate } from "@xcore/http/Paginate";
import { PER_PAGE } from "@constants/Pagination.Constant";

const req = (url: string, cookie?: string) =>
	Object.assign(new Request(url), {
		cookies: { get: (k: string) => (k === "pp_orders" ? cookie : undefined) },
	}) as unknown as Request;

test("pageParams: query beats cookie beats default; clamped 5..100; bad page → 1", () => {
	expect(Paginate.params(req("http://x/orders"), "orders")).toEqual({
		page: 1,
		perPage: PER_PAGE,
	});
	expect(
		Paginate.params(req("http://x/orders?page=3&per_page=7"), "orders"),
	).toEqual({ page: 3, perPage: 7 });
	expect(
		Paginate.params(req("http://x/orders?page=-2&per_page=1000"), "orders"),
	).toEqual({ page: 1, perPage: 100 });
	expect(Paginate.params(req("http://x/orders?per_page=1"), "orders")).toEqual({
		page: 1,
		perPage: 5,
	});
	expect(Paginate.params(req("http://x/orders", "12"), "orders")).toEqual({
		page: 1,
		perPage: 12,
	});
	expect(
		Paginate.params(req("http://x/orders?page=abc", "abc"), "orders"),
	).toEqual({
		page: 1,
		perPage: PER_PAGE,
	});
});

test("paged", () => {
	expect(Paginate.of([1, 2], 41, 3, 20)).toEqual({
		data: [1, 2],
		total: 41,
		page: 3,
		per_page: 20,
		last_page: 3,
	});
	expect(Paginate.of([], 0, 1, 20).last_page).toBe(1);
});

test("pageNumber: only a whole number from 1 up, else 1", () => {
	expect(Paginate.number("4")).toBe(4);
	for (const bad of [null, "", "0", "-3", "abc", "2.5", "1e300", "Infinity"])
		expect(Paginate.number(bad)).toBe(1);
});
