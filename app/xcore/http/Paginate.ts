import type { BunRequest } from "bun";
import {
	MAX_PER_PAGE,
	MIN_PER_PAGE,
	PER_PAGE,
} from "@constants/Pagination.Constant";
import { type Fragment, sql } from "@xcore/database/Database";

/**
 * Offset pagination shared by the list pages.
 * In: `?page=N&per_page=M`.
 * Out: `{ data, total, page, per_page, last_page }`.
 */
export type Paged<T> = {
	data: T[];
	total: number;
	page: number;
	per_page: number;
	last_page: number;
};

/**
 * A list's sort: one of the allowed columns and a direction
 * (`?sort=&dir=`).
 */
export type ListSort<K extends string> = { by: K; dir: "asc" | "desc" };

/**
 * Offset pagination shared by the list pages.
 * `?page=N&per_page=M` in, `{ data, total, page, per_page, last_page }` out.
 */
export class Paginate {
	/**
	 * A page number from the query string: a whole number from 1 up.
	 * Anything else (missing, 0, -3, 1e300) is 1.
	 * @param raw The `page` value, or null.
	 * @returns The page number.
	 */
	static number(raw: string | null): number {
		const n = Number(raw);
		return Number.isSafeInteger(n) && n > 0 ? n : 1;
	}

	/**
	 * The page number and page size of a list request.
	 * `page` comes from the query string (invalid → 1).
	 * `per_page` comes from the query string, else from the `pp_<key>` cookie,
	 * else PER_PAGE.
	 * The client sets that cookie from its viewport height
	 * (see resources/js/lib/fitPage.ts).
	 * `per_page` is clamped to MIN_PER_PAGE..MAX_PER_PAGE.
	 * @param req The current request.
	 * @param key The list's name, the end of its `pp_<key>` cookie.
	 * @returns The page number and the rows per page.
	 */
	static params(req: Request, key: string) {
		const sp = new URL(req.url).searchParams;
		const raw = Math.floor(
			Number(
				sp.get("per_page") ?? (req as BunRequest).cookies?.get(`pp_${key}`),
			),
		);
		return {
			page: Paginate.number(sp.get("page")),
			perPage:
				raw > 0
					? Math.min(MAX_PER_PAGE, Math.max(MIN_PER_PAGE, raw))
					: PER_PAGE,
		};
	}

	/**
	 * One page of a list, in the shape every list page and the API send.
	 * @param data The rows of this page.
	 * @param total How many rows the whole list has.
	 * @param page The page number, from 1.
	 * @param per_page Rows per page.
	 * @returns The page with its counts.
	 */
	static of<T>(
		data: T[],
		total: number,
		page: number,
		per_page: number,
	): Paged<T> {
		return {
			data,
			total,
			page,
			per_page,
			last_page: Math.max(1, Math.ceil(total / per_page)),
		};
	}

	/**
	 * The `limit … offset …` end of a paged list query.
	 * @param page The page number, from 1.
	 * @param perPage Rows per page.
	 * @returns The SQL fragment.
	 */
	static limit(page: number, perPage: number): Fragment {
		return sql`limit ${perPage} offset ${(page - 1) * perPage}`;
	}

	/**
	 * The list's sort from the query string, checked against the allowed columns.
	 * @param req The current request.
	 * @param allowed The columns this list can be sorted by.
	 * @returns The column and direction, or null for the list's normal order.
	 */
	static sort<K extends string>(
		req: Request,
		allowed: readonly K[],
	): ListSort<K> | null {
		const sp = new URL(req.url).searchParams;
		const by = sp.get("sort") as K;
		const dir = sp.get("dir");
		if (!allowed.includes(by) || (dir !== "asc" && dir !== "desc")) return null;
		return { by, dir };
	}
}
