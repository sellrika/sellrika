import { Url } from "@xcore/http/Url";
import { Service } from "@xcore/di";
import type {
	BundleItem,
	ProductExtra,
	ProductFull,
	ProductKind,
} from "@models/Product";
import { ProductRepository } from "@repositories/Product.Repository";
import { type Paged, Paginate } from "@xcore/http/Paginate";
import { STORE_PER_PAGE } from "@constants/Pagination.Constant";
import {
	STORE_CATALOG_TTL_MS,
	STORE_RELATED,
	type StoreSort,
} from "@constants/Store.Constant";
import { catalogVersion } from "@helpers/catalogVersion";

/**
 * What the public storefront sees of a product.
 * No costs, no internals.
 */
export type StoreProduct = {
	id: number;
	name: string;
	/**
	 * The product page: `<store>/p/<slug>`.
	 */
	slug: string;
	description: string;
	/**
	 * How much one unit holds (50 for "50 g").
	 */
	amount: number | null;
	/**
	 * "Additional data" rows, shown before the description.
	 */
	extra: ProductExtra[];
	unit: string | null;
	/**
	 * The base price, or the cheapest variant.
	 */
	price: number;
	/**
	 * The "was" price, only sent when it beats `price`.
	 */
	original_price: number | null;
	images: string[];
	category_ids: number[];
	/**
	 * Null when the stock is not tracked.
	 * For a package: how many of it the components still cover.
	 */
	stock: number | null;
	sold_out: boolean;
	kind: ProductKind;
	/**
	 * The slots the shopper picks from. [] unless kind = 'bundle'.
	 */
	bundle_items: BundleItem[];
	/**
	 * The question over the buyer's note box ("" = the default words).
	 * Null when the product asks for none.
	 */
	custom_request: string | null;
	variants: {
		id: number;
		name: string;
		price: number;
		images: string[];
		attributes: Record<string, string> | null;
		stock: number | null;
		sold_out: boolean;
	}[];
};

/**
 * The filters of one catalog page.
 */
export type BrowseFilters = {
	q: string;
	category: number | null;
	page: number;
	sort?: StoreSort;
	stock?: boolean;
	featured?: number;
};

/**
 * The public product list of a shop's online store.
 */
@Service()
export class StoreCatalogService {
	/**
	 * Each shop's public catalog, kept for a short time.
	 * `version` is the shop's catalog counter when it was loaded.
	 * ponytail: one entry per shop that had a visitor, never dropped.
	 * Add a size cap when the platform has many large shops.
	 */
	private cache = new Map<
		number,
		{ version: number; until: number; list: StoreProduct[] }
	>();

	constructor(private products: ProductRepository) {}

	/**
	 * Public product list for the storefront.
	 * Costs and internals are stripped out.
	 * The list is kept in memory for `STORE_CATALOG_TTL_MS`.
	 * A change to the shop's products or stock drops it at once
	 * (`catalogChanged`).
	 * Callers share the list: never change it or its products in place.
	 * @param shopId Owning shop.
	 * @returns Every product on sale as the storefront sees it
	 *   (see `onSale`).
	 */
	async catalog(shopId: number): Promise<StoreProduct[]> {
		// read before the query: a change during it makes this copy stale
		const version = catalogVersion(shopId);
		const hit = this.cache.get(shopId);
		if (hit && hit.version === version && hit.until > Date.now())
			return hit.list;
		const all = await this.products.allForShop(shopId);
		const list = all
			.filter((p) => this.#onSale(p))
			.map((p) => this.#publicProduct(p));
		const until = Date.now() + STORE_CATALOG_TTL_MS;
		this.cache.set(shopId, { version, until, list });
		return list;
	}

	/**
	 * One page of the public catalog.
	 * Plus the per-category product counts the filter pills show.
	 * ponytail: filters and slices the in-memory catalog (already loaded
	 * whole for the counts). Move to SQL LIMIT/OFFSET when a shop outgrows
	 * a few thousand products.
	 * @param shopId Owning shop.
	 * @param f Search text and category id (null = all).
	 *   The requested page (clamped to the last one).
	 *   The order (`STORE_SORTS`, default = featured first).
	 *   `stock` = hide sold-out products.
	 *   `featured` = how many featured products to return beside the page
	 *   (a theme's hero / featured strip asks for these).
	 * @returns The page of products, the counts keyed by category id
	 *   (`all` = the whole catalog) and the featured products
	 *   (empty unless asked for).
	 */
	async browse(
		shopId: number,
		f: BrowseFilters,
	): Promise<{
		catalog: Paged<StoreProduct>;
		counts: Record<string, number>;
		featured: StoreProduct[];
	}> {
		const all = await this.catalog(shopId);
		const q = f.q.trim().toLowerCase();
		const hits = all.filter((p) => this.#matches(p, q, f));
		// ponytail: "newest" = highest id. Ids only grow,
		// and the public shape carries no created_at.
		if (f.sort === "newest") hits.sort((a, b) => b.id - a.id);
		else if (f.sort === "price_asc") hits.sort((a, b) => a.price - b.price);
		else if (f.sort === "price_desc") hits.sort((a, b) => b.price - a.price);
		const last = Math.max(1, Math.ceil(hits.length / STORE_PER_PAGE));
		const page = Math.min(Math.max(1, f.page), last);
		const counts: Record<string, number> = { all: all.length };
		for (const p of all)
			for (const c of p.category_ids) counts[c] = (counts[c] ?? 0) + 1;
		return {
			catalog: Paginate.of(
				hits.slice((page - 1) * STORE_PER_PAGE, page * STORE_PER_PAGE),
				hits.length,
				page,
				STORE_PER_PAGE,
			),
			counts,
			// The catalog comes back featured-first
			// (Product.Repository.allForShop), so these are the top of it.
			// They are the shop's own picks,
			// whatever the visitor filtered or paged to.
			featured: f.featured ? all.slice(0, f.featured) : [],
		};
	}

	/**
	 * The "Related products" a product page shows.
	 * Other products sharing a category come first, then the rest.
	 * In-stock before sold-out, newest first within each group.
	 * ponytail: ranks the in-memory catalog (the product page loads it
	 * whole anyway). No purchase history needed.
	 * @param all The shop's public catalog.
	 * @param product The product on the page.
	 * @param limit How many to return.
	 * @returns Up to `limit` other products, best match first.
	 */
	related(
		all: StoreProduct[],
		product: StoreProduct,
		limit = STORE_RELATED,
	): StoreProduct[] {
		return all
			.filter((p) => p.id !== product.id)
			.sort(
				(a, b) =>
					this.#relatedScore(b, product) - this.#relatedScore(a, product) ||
					b.id - a.id,
			)
			.slice(0, limit);
	}

	/**
	 * Whether the storefront may show a product.
	 * @param p The product, packages resolved.
	 * @returns True when it is switched on and, for a package, every
	 *   component is switched on too.
	 */
	#onSale(p: { active: boolean; bundle_items: BundleItem[] }) {
		return p.active && p.bundle_items.every((i) => i.active);
	}

	/**
	 * One product as the storefront sees it.
	 * @param p The product with its variants and categories.
	 * @returns The public shape, costs and internals stripped out.
	 */
	#publicProduct(p: ProductFull): StoreProduct {
		const price = p.variants.length
			? Math.min(...p.variants.map((v) => v.price))
			: p.price;
		return {
			id: p.id,
			name: p.name,
			slug: p.slug,
			// its pictures load from the app's host, like the gallery's
			description: Url.uploadsIn(p.description),
			amount: p.amount,
			unit: p.unit,
			extra: p.extra,
			price,
			original_price:
				p.original_price && p.original_price > price ? p.original_price : null,
			images: p.images.map(Url.upload),
			category_ids: p.categories.map((c) => c.id),
			stock: p.track_stock && !p.variants.length ? p.stock : null,
			sold_out:
				p.track_stock &&
				(p.variants.length
					? p.variants.every((v) => v.stock <= 0)
					: p.stock <= 0),
			kind: p.kind,
			bundle_items: p.bundle_items,
			custom_request: p.custom_request ? p.custom_request_label : null,
			variants: p.variants.map((v) => ({
				id: v.id,
				name: v.name,
				price: v.price,
				images: v.images.map(Url.upload),
				attributes: v.attributes,
				stock: p.track_stock ? v.stock : null,
				sold_out: p.track_stock && v.stock <= 0,
			})),
		};
	}

	/**
	 * Does a product pass the visitor's filters?
	 * @param p The product.
	 * @param q The search text, trimmed and lower case ("" = any).
	 * @param f The category and the "in stock only" switch.
	 * @returns True when it belongs on the list.
	 */
	#matches(p: StoreProduct, q: string, f: BrowseFilters) {
		return (
			(!q || p.name.toLowerCase().includes(q)) &&
			(f.category === null || p.category_ids.includes(f.category)) &&
			(!f.stock || !p.sold_out)
		);
	}

	/**
	 * How well a product fits next to another on its page.
	 * @param p The candidate.
	 * @param product The product on the page.
	 * @returns 2 for a shared category, plus 1 when it is in stock.
	 */
	#relatedScore(p: StoreProduct, product: StoreProduct) {
		return (
			(p.category_ids.some((c) => product.category_ids.includes(c)) ? 2 : 0) +
			(p.sold_out ? 0 : 1)
		);
	}
}
