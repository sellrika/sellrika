import { Service } from "@xcore/di";
import {
	SearchRepository,
	type SearchHit,
} from "@repositories/Search.Repository";
import { SEARCH_PER_GROUP } from "@constants/Pagination.Constant";
import type { Shop } from "@models/Shop";
import type { User } from "@models/User";
import type { Role } from "@constants/User.Constant";
import { Account } from "@xcore/auth/Account";

/**
 * What `GET /search` answers.
 * A few hits per record type, empty types left out.
 * Keys = the client's `RECORD_GROUPS` (resources/js/lib/search.ts).
 */
export type SearchResults = Partial<
	Record<
		| "orders"
		| "customers"
		| "products"
		| "coupons"
		| "categories"
		| "staff"
		| "shops",
		SearchHit[]
	>
>;

/**
 * One record type the palette can find.
 * To add a type: a query in SearchRepository, one line here,
 * one line in the client registry.
 */
type Provider = {
	key: keyof SearchResults;
	/**
	 * The least role that may open this type.
	 */
	role: Role;
	find: (shop: Shop, q: string, limit: number) => Promise<SearchHit[]>;
};

/**
 * The ⌘K global search.
 * It sits above the sidebar groups, so it lives at the root of services.
 * Pages and settings sections are matched in the browser
 * (`resources/js/lib/search.ts`). This side finds records.
 */
@Service()
export class SearchService {
	/**
	 * Every record type, in the order the palette lists them.
	 */
	private readonly providers: Provider[];

	/**
	 * Build the provider table over the repository's queries.
	 * @param repo The search queries.
	 */
	constructor(repo: SearchRepository) {
		this.providers = [
			{
				key: "orders",
				role: "cashier",
				find: (s, q, n) => repo.orders(s.id, q, n),
			},
			{
				key: "customers",
				role: "cashier",
				find: (s, q, n) => repo.customers(s.id, q, n),
			},
			{
				key: "products",
				role: "manager",
				find: (s, q, n) => repo.products(s.id, q, n),
			},
			{
				key: "coupons",
				role: "admin",
				find: (s, q, n) => repo.coupons(s.id, q, n),
			},
			{
				key: "categories",
				role: "manager",
				find: (s, q, n) => repo.categories(s.id, q, n),
			},
			{
				key: "staff",
				role: "manager",
				find: (s, q, n) => repo.staff(s.owner_id, q, n),
			},
			// any staff member may switch between the account's shops
			{
				key: "shops",
				role: "cashier",
				find: (s, q, n) => repo.shops(s.owner_id, q, n),
			},
		];
	}

	/**
	 * Find records matching `q` in the active shop.
	 * Staff and shops are searched across the whole account.
	 * Only the types the role may open are searched.
	 * @param shop The active shop.
	 * @param user Who is asking. Cashiers get orders, customers and shops.
	 * @param q What was typed. Blank → nothing.
	 * @returns Hits per record type, at most `SEARCH_PER_GROUP` each.
	 *   Types with no hit are left out.
	 */
	async search(shop: Shop, user: User, q: string): Promise<SearchResults> {
		const term = q.trim().toLowerCase().slice(0, 100);
		if (!term) return {};
		const mine = this.providers.filter((p) =>
			Account.atLeast(user.role, p.role),
		);
		const found = await Promise.all(
			mine.map((p) => p.find(shop, term, SEARCH_PER_GROUP)),
		);
		const out: SearchResults = {};
		for (const [i, p] of mine.entries())
			if (found[i]!.length) out[p.key] = found[i];
		return out;
	}
}
