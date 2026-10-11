import { Db, type Fragment, sql } from "@xcore/database/Database";
import { Paginate } from "@xcore/http/Paginate";
import { t } from "@xcore/i18n/I18n";
import { Storage } from "@xcore/storage/Storage";
import type { SQL } from "bun";
import { Service } from "@xcore/di";
import { parseJson } from "@helpers/json";
import type { Category } from "@models/Category";
import type {
	BundleItem,
	BundleOption,
	Product,
	ProductFull,
	ProductKind,
	ProductVariant,
} from "@models/Product";
import type { ProductInput } from "@validators/Product.Validator";
import { slugify } from "@helpers/slug";
import { catalogChanged } from "@helpers/catalogVersion";
import type { ProductSort } from "@constants/Product.Constant";

/** A package slot joined with its component product, as `withBundles` reads it. */
type SlotRow = {
	id: number;
	bundle_id: number;
	product_id: number;
	variant_ids: unknown;
	qty: unknown;
	name: string;
	price: number;
	track_stock: unknown;
	stock: unknown;
	active: unknown;
};

/** A variant of a component product, as `withBundles` reads it. */
type SlotVariant = {
	id: number;
	product_id: number;
	name: string;
	price: number;
	stock: unknown;
};

/**
 * One resolved slot of a package line.
 * The exact unit that has to leave (and come back to) the shelf.
 */
export type LineComponent = {
	product_id: number;
	variant_id: number | null;
	qty: number;
	name: string;
	track_stock: boolean;
	stock: number;
};
/**
 * What checkout needs per cart line.
 * Price / cost / name from the DB (never the client) + stock tracking state.
 */
export type PriceLine = {
	product_id: number;
	variant_id: number | null;
	name: string;
	price: number;
	cost: number | null;
	track_stock: boolean;
	stock: number;
	components: LineComponent[] | null;
	/**
	 * The picture at sale time (`/uploads/…`), or null.
	 * Snapshotted on the order line.
	 */
	image: string | null;
	/**
	 * true = the buyer must write a custom request for this product.
	 * Online store only.
	 */
	custom_request?: boolean;
};

/** The product row `priceLine` reads. */
type PriceRow = Pick<
	Product,
	"id" | "name" | "kind" | "price" | "purchase_price"
> & { track_stock: unknown; stock: unknown; images: unknown; nv: unknown };

/**
 * A plain item as the package editor needs it.
 * Only its name, price, first pictures, on/off switch and variants.
 */
export type PackageComponent = {
	id: number;
	name: string;
	price: number;
	images: string[];
	active: boolean;
	variants: { id: number; name: string; price: number }[];
};

/**
 * Products, variants, categories and package (bundle) recipes.
 * The catalogue.
 */
@Service()
export class ProductRepository {
	/**
	 * The whole catalogue of a shop, packages resolved.
	 * @param shopId Owning shop.
	 * @returns Every product with its variants, categories and package slots.
	 */
	async allForShop(shopId: number): Promise<ProductFull[]> {
		const products =
			await sql`select * from products where shop_id = ${shopId} order by featured desc, updated_at desc, id desc`;
		return this.#hydrate(
			products,
			sql`product_id in (select id from products where shop_id = ${shopId})`,
			sql`c.shop_id = ${shopId}`,
		);
	}

	/**
	 * What a package may be built from: every plain item of a shop,
	 * with only what the package editor shows.
	 * No descriptions, no extra data, no categories.
	 * @param shopId Owning shop.
	 * @returns The items, in the catalogue's order, with their variants.
	 */
	async components(shopId: number): Promise<PackageComponent[]> {
		const rows: {
			id: number;
			name: string;
			price: number;
			images: unknown;
			active: unknown;
		}[] =
			await sql`select id, name, price, images, active from products where shop_id = ${shopId} and coalesce(kind, 'item') <> 'bundle' order by featured desc, updated_at desc, id desc`;
		const variants: {
			id: number;
			product_id: number;
			name: string;
			price: number;
		}[] =
			await sql`select id, product_id, name, price from product_variants where product_id in (select id from products where shop_id = ${shopId}) order by position, id`;
		const byId = new Map<number, PackageComponent>();
		for (const r of rows)
			byId.set(r.id, {
				id: r.id,
				name: r.name,
				price: r.price,
				images: this.#parseImages(r.images),
				active: !!r.active,
				variants: [],
			});
		for (const { product_id, id, name, price } of variants)
			byId.get(product_id)?.variants.push({ id, name, price });
		return [...byId.values()];
	}

	/**
	 * The id and name of every product of a shop, for a picker.
	 * @param shopId Owning shop.
	 * @returns The products, in the catalogue's order.
	 */
	async names(shopId: number): Promise<{ id: number; name: string }[]> {
		return sql`select id, name from products where shop_id = ${shopId} order by featured desc, updated_at desc, id desc`;
	}

	/**
	 * One page of products.
	 * @param shopId Owning shop.
	 * @param q Matches name / SKU / product barcode / variant barcode
	 *   (substring, case-insensitive).
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @param f Extra filters.
	 *   `category` = a category id.
	 *   `ids` = an explicit list (the POS re-syncs a restored cart with it).
	 *   `active` = only products switched on,
	 *   and no package with a switched-off component (the POS).
	 *   `sold` = also count the units sold on orders that were not voided
	 *   (the admin list).
	 *   `sort` = a column and direction (the admin list).
	 *   Else featured first, then the most recently edited.
	 * @returns A page of products with variants, categories
	 *   and resolved package slots.
	 */
	async pageForShop(
		shopId: number,
		q: string,
		page: number,
		perPage: number,
		f: {
			category?: number | null;
			ids?: number[];
			active?: boolean;
			sold?: boolean;
			sort?: ProductSort | null;
		} = {},
	) {
		const like = `%${q.toLowerCase()}%`;
		const category = f.category ?? 0;
		const only = f.ids?.length ? f.ids : [0];
		const where = sql`where p.shop_id = ${shopId} and (${q} = '' or lower(p.name) like ${like} or lower(p.barcode) like ${like} or lower(p.sku) like ${like}
      or exists (select 1 from product_variants v where v.product_id = p.id and (lower(v.barcode) like ${like} or lower(v.sku) like ${like})))
      and (${category} = 0 or exists (select 1 from product_categories pc where pc.product_id = p.id and pc.category_id = ${category}))
      and (${f.ids ? 1 : 0} = 0 or p.id in ${sql(only)})
      and (${f.active ? 1 : 0} = 0 or (p.active = ${true}
        and not exists (select 1 from bundle_items bi join products c on c.id = bi.product_id where bi.bundle_id = p.id and c.active = ${false})))`;
		const [{ n }] = await sql`select count(*) as n from products p ${where}`;
		// sorting by units sold needs every product's number, so it joins them all
		// any other order counts only the products of this page, afterwards
		const joined = !!f.sold && f.sort?.by === "sold";
		const soldJoin = joined
			? sql`left join (select i.product_id, sum(i.qty) as sold from order_items i join orders o on o.id = i.order_id
              where o.shop_id = ${shopId} and o.status <> 'voided' group by i.product_id) s on s.product_id = p.id`
			: sql``;
		const rows: Product[] =
			await sql`select p.*${joined ? sql`, coalesce(s.sold, 0) as sold` : sql``} from products p ${soldJoin} ${where}
            order by ${this.#sortBy(f.sort, joined)} p.featured desc, p.updated_at desc, p.id desc
            ${Paginate.limit(page, perPage)}`;
		const ids = rows.map((p) => p.id);
		const products = f.sold
			? await this.#withSold(rows, shopId, joined ? null : ids)
			: rows;
		const data = ids.length
			? await this.#hydrate(
					products,
					sql`product_id in ${sql(ids)}`,
					sql`pc.product_id in ${sql(ids)}`,
				)
			: [];
		return Paginate.of(data, Number(n), page, perPage);
	}

	/**
	 * One product with everything hanging off it.
	 * @param id Product id.
	 * @param shopId Shop it must belong to.
	 * @returns The product, or null.
	 */
	async find(id: number, shopId: number): Promise<ProductFull | null> {
		const products =
			await sql`select * from products where id = ${id} and shop_id = ${shopId}`;
		if (!products.length) return null;
		const [product] = await this.#hydrate(
			products,
			sql`product_id = ${id}`,
			sql`pc.product_id = ${id}`,
		);
		return product!;
	}

	/**
	 * Product + variant lookup for checkout.
	 * The one place POS and the online store resolve a cart line.
	 * A product that has variants must be sold as one of them.
	 * Variant cost falls back to the product's purchase price.
	 * @param productId Product id.
	 * @param variantId Variant id, or null for the product itself.
	 * @param shopId Shop it must belong to.
	 * @param choices For a package: slot id → chosen variant id.
	 * @returns The priced line (with resolved `components` for a package).
	 *   `{error}` when a slot with 2+ options wasn't picked.
	 *   Null when the unit doesn't exist, is switched off
	 *   or can't be sold that way.
	 */
	async priceLine(
		productId: number,
		variantId: number | null,
		shopId: number,
		choices: Record<string, number> = {},
	): Promise<PriceLine | { error: string } | null> {
		const [p] =
			await sql`select id, name, kind, price, purchase_price, track_stock, stock, images, custom_request, (select count(*) from product_variants v where v.product_id = products.id) as nv
      from products where id = ${productId} and shop_id = ${shopId} and active = ${true}`;
		if (!p) return null;
		const line = await this.#unitLine(p, variantId, shopId, choices);
		return line && !("error" in line)
			? { ...line, custom_request: !!p.custom_request }
			: line;
	}

	/**
	 * Names of the packages that contain this product.
	 * @param productId The component product.
	 * @param variantId Only slots pointing at this variant, or null for any variant.
	 * @returns Distinct package names.
	 */
	async usedInBundles(
		shopId: number,
		productId: number,
		variantId: number | null,
	): Promise<string[]> {
		const rows: { name: string; variant_ids: unknown }[] =
			await sql`select b.name, bi.variant_ids from bundle_items bi join products b on b.id = bi.bundle_id where bi.product_id = ${productId} and b.shop_id = ${shopId} order by bi.id`;
		const hits = rows.filter((r) => this.#slotUses(r.variant_ids, variantId));
		return [...new Set(hits.map((r) => r.name as string))];
	}

	/**
	 * What a package needs to know about a candidate component.
	 * Does it exist here, is it itself a package, which variants does it have.
	 * @param shopId Owning shop.
	 * @param id Candidate product id.
	 * @returns Its kind and variant ids, or null when it isn't a product of this shop.
	 */
	async component(
		shopId: number,
		id: number,
	): Promise<{ id: number; kind: ProductKind; variant_ids: number[] } | null> {
		const [p] =
			await sql`select id, kind from products where id = ${id} and shop_id = ${shopId}`;
		if (!p) return null;
		const vs: { id: number }[] =
			await sql`select id from product_variants where product_id = ${id}`;
		return {
			id: p.id,
			kind: (p.kind ?? "item") as ProductKind,
			variant_ids: vs.map((v) => v.id as number),
		};
	}

	/**
	 * Barcodes are unique per shop, across products and variants alike.
	 * @param shopId Owning shop.
	 * @param barcode The barcode to check.
	 * @param exceptProductId Product allowed to keep it (the one being edited).
	 * @returns The name of the product that already uses it, or null.
	 */
	async barcodeOwner(
		shopId: number,
		barcode: string,
		exceptProductId = 0,
	): Promise<string | null> {
		const [p] =
			await sql`select name from products where shop_id = ${shopId} and barcode = ${barcode} and id <> ${exceptProductId}
      union all
      select p.name from product_variants v join products p on p.id = v.product_id
        where p.shop_id = ${shopId} and v.barcode = ${barcode} and p.id <> ${exceptProductId}`;
		return p?.name ?? null;
	}

	/**
	 * The product that carries a SKU, on itself or one of its variants.
	 * What an import checks before adding a row.
	 * @param shopId Owning shop.
	 * @param sku The SKU to look for.
	 * @returns The product id, or null.
	 */
	async idBySku(shopId: number, sku: string): Promise<number | null> {
		const [p] =
			await sql`select id from products where shop_id = ${shopId} and sku = ${sku}
      union all
      select p.id from product_variants v join products p on p.id = v.product_id where p.shop_id = ${shopId} and v.sku = ${sku}`;
		return p?.id ?? null;
	}

	/**
	 * Link categories to products, keeping the links they already have.
	 * The list's "Add to categories".
	 * Only the shop's own products and categories are linked.
	 * Ids of another shop are skipped.
	 * Like `setFeatured`, not an edit, so updated_at stays
	 * (the list keeps its order).
	 * @param shopId Shop both sides must belong to.
	 * @param productIds The products.
	 * @param categoryIds The categories to add.
	 * @returns The ids of the shop's products among `productIds`.
	 */
	async addCategories(
		shopId: number,
		productIds: number[],
		categoryIds: number[],
	): Promise<number[]> {
		return sql
			.begin((tx) => this.#linkCategories(tx, shopId, productIds, categoryIds))
			.finally(() => catalogChanged(shopId));
	}

	/**
	 * Quick toggle from the product list.
	 * ponytail: doesn't touch updated_at — pinning isn't an edit.
	 * @param id Product id.
	 * @param shopId Shop it must belong to.
	 * @param featured Whether it should be pinned.
	 */
	async setFeatured(id: number, shopId: number, featured: boolean) {
		await sql`update products set featured = ${featured} where id = ${id} and shop_id = ${shopId}`;
		catalogChanged(shopId);
	}

	/**
	 * Quick on/off toggle from the product list.
	 * Like `setFeatured`, not an edit, so updated_at stays.
	 * @param id Product id.
	 * @param shopId Shop it must belong to.
	 * @param active Whether the POS and the online store may sell it.
	 */
	async setActive(id: number, shopId: number, active: boolean) {
		await sql`update products set active = ${active} where id = ${id} and shop_id = ${shopId}`;
		catalogChanged(shopId);
	}

	/**
	 * Create a product with its variants, categories and package slots.
	 * @param shopId Owning shop.
	 * @param d Validated (and sanitised) product input.
	 * @param userId Credited in stock_movements for stock typed into the form.
	 * @returns The created product row.
	 */
	create(shopId: number, d: ProductInput, userId: number | null = null) {
		return sql
			.begin((tx) => this.#insert(tx, shopId, d, userId))
			.finally(() => catalogChanged(shopId));
	}

	/**
	 * Overwrite a product and re-sync its variants, categories and package slots.
	 * @param id Product id.
	 * @param shopId Shop it must belong to.
	 * @param d Validated (and sanitised) product input.
	 * @param userId Credited in stock_movements for stock typed into the form.
	 * @returns The updated product row, or null when it doesn't belong to this shop.
	 */
	update(
		id: number,
		shopId: number,
		d: ProductInput,
		userId: number | null = null,
	) {
		return sql
			.begin((tx) => this.#overwrite(tx, id, shopId, d, userId))
			.finally(() => catalogChanged(shopId));
	}

	/**
	 * Delete a product and everything that hangs off it.
	 * Its own package recipe is included.
	 * Products used *inside* a package are guarded in ProductService.
	 * @param id Product id.
	 * @param shopId Shop it must belong to.
	 * @returns A promise that ends when the product is gone.
	 */
	delete(id: number, shopId: number) {
		return sql
			.begin((tx) => this.#drop(tx, id, shopId))
			.finally(() => catalogChanged(shopId));
	}
	/**
	 * Read a JSON column that may be empty.
	 * JSON columns are text on SQLite, already parsed on Postgres.
	 * @param v The column as the driver returned it.
	 * @returns The parsed value, or null for an empty column.
	 */
	#parseColumn(v: unknown) {
		// biome-ignore lint/suspicious/noExplicitAny: the column's shape is the caller's
		return parseJson<any>(v, null);
	}

	/**
	 * Read an `images` column.
	 * @param v The column as the driver returned it.
	 * @returns The image paths, [] for an empty column.
	 */
	#parseImages(v: unknown): string[] {
		return this.#parseColumn(v) ?? [];
	}

	/**
	 * Turn a `product_variants` row into a `ProductVariant`.
	 * @param v The raw row.
	 * @returns The variant with parsed attributes and images, and a real count.
	 */
	#parseVariant(v: ProductVariant): ProductVariant {
		return {
			...v,
			attributes: this.#parseColumn(v.attributes) ?? null,
			images: this.#parseImages(v.images),
			stock: Number(v.stock),
		};
	}

	/**
	 * The `images` column of a product or variant being saved.
	 * @param d The validated input.
	 * @returns The image paths as JSON text.
	 */
	#images(d: { images: string[] }) {
		return JSON.stringify(d.images);
	}

	/**
	 * The picture an order line keeps: the first of our own uploads in the lists given.
	 * An https link is never kept — the other site may change or remove it.
	 * @param lists Image columns as stored (JSON text or arrays),
	 *   the preferred one first.
	 * @returns A `/uploads/…` path, or null.
	 */
	#lineImage(...lists: unknown[]): string | null {
		for (const list of lists) {
			const hit = this.#parseImages(list).find(Storage.isUploadUrl);
			if (hit) return hit;
		}
		return null;
	}

	/**
	 * "Additional data" rows as stored.
	 * An untitled row is dropped.
	 * So a blank row left in the form never fails the save.
	 * @param d The validated product input.
	 * @returns The rows as JSON text.
	 */
	#extra(d: ProductInput) {
		return JSON.stringify((d.extra ?? []).filter((r) => r.title));
	}

	/**
	 * The package slots of a product being saved.
	 * @param d The validated product input.
	 * @returns Its slots, [] when it is not a package.
	 */
	#bundleItems(d: ProductInput) {
		return d.kind === "bundle" ? (d.bundle_items ?? []) : [];
	}

	/**
	 * First free slug for a product name in this shop.
	 * "corner-mug", "corner-mug-2", …
	 * A name with no latin letters gives `p-<id>`.
	 * @param tx Transaction to run in.
	 * @param shopId Owning shop.
	 * @param name The product name.
	 * @param exceptId Product allowed to keep its slug (the one being edited).
	 * @returns The slug.
	 */
	async #uniqueSlug(tx: SQL, shopId: number, name: string, exceptId = 0) {
		const base = slugify(name) || `p-${exceptId || Date.now()}`;
		let slug = base;
		for (
			let i = 2;
			(
				await tx`select 1 from products where shop_id = ${shopId} and slug = ${slug} and id <> ${exceptId}`
			).length;
			i++
		)
			slug = `${base}-${i}`;
		return slug;
	}

	/**
	 * Turn a `products` row into a `ProductFull` with nothing hanging off it yet.
	 * @param p The raw row.
	 * @returns The product with real booleans, numbers and parsed lists.
	 */
	#full(p: Product): ProductFull {
		return {
			...p,
			images: this.#parseImages(p.images),
			extra: this.#parseColumn(p.extra) ?? [],
			track_stock: !!p.track_stock,
			featured: !!p.featured,
			custom_request: !!p.custom_request,
			active: !!p.active,
			stock: Number(p.stock),
			low_stock_at: Number(p.low_stock_at),
			kind: (p.kind ?? "item") as ProductKind,
			bundle_items: [],
			categories: [],
			variants: [],
		};
	}

	/**
	 * Hang the variants and categories off their products.
	 * @param products The product rows.
	 * @param variants The variant rows of those products.
	 * @param cats The category rows, each with the product it is linked to.
	 * @returns The products, in the order they came in.
	 */
	#attach(
		products: Product[],
		variants: ProductVariant[],
		cats: (Category & { product_id: number })[],
	): ProductFull[] {
		const byId = new Map<number, ProductFull>();
		for (const p of products) byId.set(p.id, this.#full(p));
		for (const v of variants)
			byId.get(v.product_id)?.variants.push(this.#parseVariant(v));
		for (const { product_id, ...c } of cats)
			byId.get(product_id)?.categories.push(c);
		return [...byId.values()];
	}

	/**
	 * How many packages one slot can still fill: the best of its options.
	 * An untracked option = unlimited.
	 * @param it The slot.
	 * @returns The count, or null for unlimited.
	 */
	#slotAvailability(it: BundleItem): number | null {
		// every allowed variant was deleted → unsellable
		if (!it.options.length) return 0;
		const per = it.options.map((o) =>
			o.stock == null ? null : Math.floor(o.stock / it.qty),
		);
		return per.some((n) => n == null) ? null : Math.max(...(per as number[]));
	}

	/**
	 * A package is as available as its scarcest slot.
	 * @param items The package's slots.
	 * @returns The count, or null when nothing in it is tracked.
	 */
	#bundleAvailability(items: BundleItem[]): number | null {
		const per = items
			.map((x) => this.#slotAvailability(x))
			.filter((n): n is number => n != null);
		return per.length ? Math.min(...per) : null;
	}

	/**
	 * What a slot can be filled with.
	 * The allowed variants of its component, or the component itself.
	 * @param r The slot.
	 * @param variants The variants of every component in the list.
	 * @returns The options, each with its stock (null = not tracked).
	 */
	#slotOptions(r: SlotRow, variants: SlotVariant[]): BundleOption[] {
		const allowed: number[] | null = this.#parseColumn(r.variant_ids) ?? null;
		const track = !!r.track_stock;
		if (!allowed?.length)
			return [
				{
					variant_id: null,
					name: r.name,
					price: r.price,
					stock: track ? Number(r.stock) : null,
				},
			];
		const options: BundleOption[] = [];
		for (const v of variants) {
			if (v.product_id !== r.product_id || !allowed.includes(v.id)) continue;
			options.push({
				variant_id: v.id,
				name: v.name,
				price: v.price,
				stock: track ? Number(v.stock) : null,
			});
		}
		return options;
	}

	/**
	 * Fill in the slots of every package in the list.
	 * Its `track_stock` / `stock` are worked out from the components.
	 * So the POS grid, the storefront and the cart-restore stock capping
	 * work on packages without knowing about them.
	 * @param products The products, packages among them.
	 * @returns The same list, packages filled in.
	 */
	async #withBundles(products: ProductFull[]): Promise<ProductFull[]> {
		const ids = products.filter((p) => p.kind === "bundle").map((p) => p.id);
		if (!ids.length) return products;
		const rows: SlotRow[] =
			await sql`select bi.id, bi.bundle_id, bi.product_id, bi.variant_ids, bi.qty, c.name, c.price, c.track_stock, c.stock, c.active
	    from bundle_items bi join products c on c.id = bi.product_id where bi.bundle_id in ${sql(ids)} order by bi.id`;
		const compIds = [...new Set(rows.map((r) => r.product_id))];
		const variants: SlotVariant[] = compIds.length
			? await sql`select id, product_id, name, price, stock from product_variants where product_id in ${sql(compIds)} order by position, id`
			: [];
		const byId = new Map(products.map((p) => [p.id, p]));
		for (const r of rows) {
			const options = this.#slotOptions(r, variants);
			byId.get(r.bundle_id)?.bundle_items.push({
				id: r.id,
				product_id: r.product_id,
				qty: Number(r.qty),
				name: r.name,
				active: !!r.active,
				options,
			});
		}
		for (const id of ids) {
			const p = byId.get(id)!;
			const avail = this.#bundleAvailability(p.bundle_items);
			p.track_stock = avail != null;
			p.stock = avail ?? 0;
		}
		return products;
	}

	/**
	 * Does a package slot point at this variant?
	 * @param variantIds The slot's `variant_ids` column.
	 * @param variantId The variant, or null for any variant.
	 * @returns True when the slot counts.
	 */
	#slotUses(variantIds: unknown, variantId: number | null): boolean {
		if (variantId == null) return true;
		return ((this.#parseColumn(variantIds) ?? []) as number[]).includes(
			variantId,
		);
	}

	/**
	 * The ORDER BY start for a sort of the admin product list.
	 * Only fixed SQL from this list is used, never the request's text.
	 * Empty values (no category, stock not tracked) always go last.
	 * @param sort The column and direction, or none.
	 * @param sold Whether the `s.sold` join is there.
	 *   It is there only for the sort by units sold.
	 * @returns A fragment ending in a comma, or an empty one.
	 */
	#sortBy(sort: ProductSort | null | undefined, sold: boolean) {
		if (!sort || (sort.by === "sold" && !sold)) return sql``;
		const value = {
			name: sql`lower(p.name)`,
			category: sql`(select min(lower(c.name)) from product_categories pc join categories c on c.id = pc.category_id where pc.product_id = p.id)`,
			active: sql`p.active`,
			stock: sql`(case when p.track_stock then coalesce((select sum(v.stock) from product_variants v where v.product_id = p.id), p.stock) end)`,
			price: sql`coalesce((select min(v.price) from product_variants v where v.product_id = p.id), p.price)`,
			sold: sql`coalesce(s.sold, 0)`,
		}[sort.by];
		return Db.nullsLast(value, sort.dir);
	}

	/**
	 * Price one package line.
	 * Pick the option per slot: the only one, or the customer's choice.
	 * Sum the component costs.
	 * Work out how many of this exact package are still sellable.
	 * Costs are read here (not in the payload shape),
	 * so the public storefront never sees them.
	 * @param p The package's product row.
	 * @param shopId Shop it must belong to.
	 * @param choices Slot id → chosen variant id.
	 * @returns The priced line, or `{error}` when it can't be sold.
	 */
	async #bundleLine(
		p: Pick<Product, "id" | "name" | "price"> & { images: unknown },
		shopId: number,
		choices: Record<string, number>,
	): Promise<PriceLine | { error: string }> {
		const rows: {
			id: number;
			product_id: number;
			variant_ids: unknown;
			qty: unknown;
			name: string;
			purchase_price: number | null;
			track_stock: unknown;
			stock: unknown;
			active: unknown;
		}[] =
			await sql`select bi.id, bi.product_id, bi.variant_ids, bi.qty, c.name, c.purchase_price, c.track_stock, c.stock, c.active
	    from bundle_items bi join products c on c.id = bi.product_id and c.shop_id = ${shopId} where bi.bundle_id = ${p.id} order by bi.id`;
		// no contents, or a component switched off → the package can't be sold
		if (!rows.length || rows.some((r) => !r.active))
			return { error: t("server.product_unavailable", { name: p.name }) };
		const components: LineComponent[] = [];
		const costs: (number | null)[] = [];
		const picked: string[] = [];
		for (const r of rows) {
			const allowed: number[] | null = this.#parseColumn(r.variant_ids) ?? null;
			let unit = {
				product_id: r.product_id as number,
				variant_id: null as number | null,
				qty: Number(r.qty),
				name: r.name as string,
				track_stock: !!r.track_stock,
				stock: Number(r.stock),
			};
			let cost: number | null = r.purchase_price ?? null;
			if (allowed?.length) {
				const vs: {
					id: number;
					name: string;
					purchase_price: number | null;
					stock: unknown;
				}[] =
					await sql`select id, name, purchase_price, stock from product_variants where product_id = ${r.product_id} and id in ${sql(allowed)} order by position, id`;
				// every allowed variant was deleted
				if (!vs.length) return { error: `“${p.name}” is no longer available` };
				const chosen =
					vs.length === 1
						? vs[0]
						: vs.find((v) => v.id === choices[String(r.id)]);
				if (!chosen)
					return { error: t("server.product_choose_option", { name: p.name }) };
				// "12 × Red" — the receipt says how many of what
				if (vs.length > 1) picked.push(`${r.qty} × ${chosen.name}`);
				unit = {
					...unit,
					variant_id: chosen.id,
					name: `${r.name} — ${chosen.name}`,
					stock: Number(chosen.stock),
				};
				cost = chosen.purchase_price ?? r.purchase_price ?? null;
			}
			components.push(unit);
			costs.push(cost);
		}
		const per = components
			.filter((c) => c.track_stock)
			.map((c) => Math.floor(c.stock / c.qty));
		return {
			product_id: p.id,
			variant_id: null,
			name: picked.length ? `${p.name} (${picked.join(", ")})` : p.name,
			price: p.price,
			cost: costs.every((c) => c == null)
				? null
				: costs.reduce(
						(s: number, c, i) => s + (c ?? 0) * components[i]!.qty,
						0,
					),
			track_stock: per.length > 0,
			stock: per.length ? Math.min(...per) : 0,
			components,
			image: this.#lineImage(p.images),
		};
	}

	/**
	 * Write the ledger row for stock typed straight into the product form.
	 * It still goes through the ledger, so the history always adds up.
	 * @param tx Transaction to run in.
	 * @param shopId Owning shop.
	 * @param productId Product id.
	 * @param variantId Variant id, or null for the product itself.
	 * @param qty The signed change.
	 * @param userId Who typed it.
	 * @returns The insert query.
	 */
	#formMovement(
		tx: SQL,
		shopId: number,
		productId: number,
		variantId: number | null,
		qty: number,
		userId: number | null,
	) {
		return tx`insert into stock_movements (shop_id, product_id, variant_id, type, qty, reason, user_id) values (${shopId}, ${productId}, ${variantId}, 'adjustment', ${qty}, 'Set on product form', ${userId})`;
	}

	/**
	 * Bring what hangs off a product in line with the form.
	 * Package slots are replaced wholesale. Categories are replaced.
	 * Variants are upserted by id, which keeps ids that past orders point at.
	 * The rest of the variants are dropped.
	 * @param tx Transaction to run in.
	 * @param shopId Owning shop.
	 * @param productId Product id.
	 * @param d Validated product input.
	 * @param userId Credited in stock_movements for stock typed into the form.
	 */
	async #syncRelations(
		tx: SQL,
		shopId: number,
		productId: number,
		d: ProductInput,
		userId: number | null,
	) {
		await tx`delete from bundle_items where bundle_id = ${productId}`;
		for (const it of this.#bundleItems(d)) {
			await tx`insert into bundle_items (bundle_id, product_id, variant_ids, qty) values (${productId}, ${it.product_id}, ${it.variant_ids?.length ? JSON.stringify(it.variant_ids) : null}, ${it.qty})`;
		}
		await tx`delete from product_categories where product_id = ${productId}`;
		for (const cid of new Set(d.category_ids))
			await tx`insert into product_categories (product_id, category_id) values (${productId}, ${cid})`;

		const keep: number[] = [];
		for (const [i, v] of d.variants.entries()) {
			if (v.id) {
				const [before] =
					await tx`select stock from product_variants where id = ${v.id} and product_id = ${productId}`;
				if (before) {
					const stock = v.stock ?? Number(before.stock);
					await tx`update product_variants set name = ${v.name}, price = ${v.price}, purchase_price = ${v.purchase_price}, position = ${i}, attributes = ${this.#attrs(v)}, sku = ${v.sku}, barcode = ${v.barcode}, images = ${this.#images(v)}, stock = ${stock} where id = ${v.id}`;
					if (stock !== Number(before.stock))
						await this.#formMovement(
							tx,
							shopId,
							productId,
							v.id,
							stock - Number(before.stock),
							userId,
						);
					keep.push(v.id);
					continue;
				}
			}
			const [row] = await Db.insert(
				tx,
				"product_variants",
				tx`insert into product_variants (product_id, name, price, purchase_price, position, attributes, sku, barcode, images, stock) values (${productId}, ${v.name}, ${v.price}, ${v.purchase_price}, ${i}, ${this.#attrs(v)}, ${v.sku}, ${v.barcode}, ${this.#images(v)}, ${v.stock ?? 0})`,
				tx`id`,
			);
			if (v.stock)
				await this.#formMovement(
					tx,
					shopId,
					productId,
					row.id,
					v.stock,
					userId,
				);
			keep.push(row.id);
		}
		const existing =
			await tx`select id from product_variants where product_id = ${productId}`;
		for (const { id } of existing) {
			if (keep.includes(id)) continue;
			await tx`delete from stock_movements where variant_id = ${id}`;
			await tx`delete from product_variants where id = ${id}`;
		}
	}

	/**
	 * The `attributes` column of a variant being saved.
	 * @param v The validated variant input.
	 * @returns The attributes as JSON text, or null when it has none.
	 */
	#attrs(v: { attributes?: Record<string, string> | null }) {
		return v.attributes && Object.keys(v.attributes).length
			? JSON.stringify(v.attributes)
			: null;
	}

	/**
	 * Give each product row its units sold as a number.
	 * Orders that were voided do not count.
	 * @param rows The product rows of one page.
	 * @param shopId Owning shop.
	 * @param ids The products to count for.
	 *   Null when the rows already carry `sold` from the query.
	 * @returns The rows, each with `sold`.
	 */
	async #withSold(rows: Product[], shopId: number, ids: number[] | null) {
		const sold = new Map<number, number>();
		const counted: { product_id: number; sold: unknown }[] = ids?.length
			? await sql`select i.product_id, sum(i.qty) as sold from order_items i join orders o on o.id = i.order_id
          where o.shop_id = ${shopId} and o.status <> 'voided' and i.product_id in ${sql(ids)} group by i.product_id`
			: [];
		for (const c of counted) sold.set(c.product_id, Number(c.sold));
		const out: Product[] = [];
		for (const p of rows)
			out.push({ ...p, sold: ids ? (sold.get(p.id) ?? 0) : Number(p.sold) });
		return out;
	}

	/**
	 * Load what hangs off some product rows: variants, categories, package slots.
	 * @param products The product rows.
	 * @param variantsOf Which `product_variants` rows to read (a condition).
	 * @param catsOf Which category links to read (a condition over
	 *   `product_categories pc` and `categories c`).
	 * @returns The products with everything hanging off them.
	 */
	async #hydrate(
		products: Product[],
		variantsOf: Fragment,
		catsOf: Fragment,
	): Promise<ProductFull[]> {
		const variants =
			await sql`select * from product_variants where ${variantsOf} order by position, id`;
		const cats =
			await sql`select pc.product_id, c.* from product_categories pc join categories c on c.id = pc.category_id where ${catsOf} order by c.position, c.name`;
		return this.#withBundles(this.#attach(products, variants, cats));
	}

	/**
	 * The priced line of a product row read by `priceLine`.
	 * @param p The product row.
	 * @param variantId Variant id, or null for the product itself.
	 * @param shopId Shop it must belong to.
	 * @param choices For a package: slot id → chosen variant id.
	 * @returns The same as `priceLine`.
	 */
	async #unitLine(
		p: PriceRow,
		variantId: number | null,
		shopId: number,
		choices: Record<string, number>,
	): Promise<PriceLine | { error: string } | null> {
		if (p.kind === "bundle")
			return variantId == null ? this.#bundleLine(p, shopId, choices) : null;
		const track = !!p.track_stock;
		if (variantId == null)
			return Number(p.nv)
				? null
				: {
						product_id: p.id,
						variant_id: null,
						name: p.name,
						price: p.price,
						cost: p.purchase_price ?? null,
						track_stock: track,
						stock: Number(p.stock),
						components: null,
						image: this.#lineImage(p.images),
					};
		const [v] =
			await sql`select id, name, price, purchase_price, stock, images from product_variants where id = ${variantId} and product_id = ${p.id}`;
		return v
			? {
					product_id: p.id,
					variant_id: v.id,
					name: `${p.name} — ${v.name}`,
					price: v.price,
					cost: v.purchase_price ?? p.purchase_price ?? null,
					track_stock: track,
					stock: Number(v.stock),
					components: null,
					image: this.#lineImage(v.images, p.images),
				}
			: null;
	}

	/**
	 * The writes of `addCategories`, inside its transaction.
	 * @param tx The open transaction.
	 * @param shopId Shop both sides must belong to.
	 * @param productIds The products.
	 * @param categoryIds The categories to add.
	 * @returns The ids of the shop's products among `productIds`.
	 */
	async #linkCategories(
		tx: SQL,
		shopId: number,
		productIds: number[],
		categoryIds: number[],
	): Promise<number[]> {
		await tx`insert into product_categories (product_id, category_id)
        select p.id, c.id from products p join categories c on c.shop_id = p.shop_id
        where p.shop_id = ${shopId} and p.id in ${tx(productIds)} and c.id in ${tx(categoryIds)}
          and not exists (select 1 from product_categories x where x.product_id = p.id and x.category_id = c.id)`;
		const rows: { id: number }[] =
			await tx`select id from products where shop_id = ${shopId} and id in ${tx(productIds)}`;
		return rows.map((r) => r.id);
	}

	/**
	 * The writes of `create`, inside its transaction.
	 * @param tx The open transaction.
	 * @param shopId Owning shop.
	 * @param d Validated (and sanitised) product input.
	 * @param userId Credited in stock_movements for stock typed into the form.
	 * @returns The created product row.
	 */
	async #insert(
		tx: SQL,
		shopId: number,
		d: ProductInput,
		userId: number | null,
	) {
		// with variants the count lives on each variant
		const stock = d.variants.length ? 0 : (d.stock ?? 0);
		const [p] = await Db.insert(
			tx,
			"products",
			tx`insert into products (shop_id, name, slug, description, price, purchase_price, original_price, images, sku, barcode, unit, amount, extra, track_stock, stock, low_stock_at, featured, custom_request, custom_request_label, active, kind, updated_at)
        values (${shopId}, ${d.name}, ${await this.#uniqueSlug(tx, shopId, d.name)}, ${d.description}, ${d.price}, ${d.purchase_price}, ${d.original_price}, ${this.#images(d)}, ${d.sku}, ${d.barcode}, ${d.unit}, ${d.amount ?? null}, ${this.#extra(d)}, ${d.track_stock}, ${stock}, ${d.low_stock_at}, ${d.featured}, ${d.custom_request ?? false}, ${d.custom_request_label ?? ""}, ${d.active}, ${d.kind === "bundle" ? "bundle" : "item"}, current_timestamp)`,
		);
		if (stock) await this.#formMovement(tx, shopId, p.id, null, stock, userId);
		await this.#syncRelations(tx, shopId, p.id, d, userId);
		return p as Product;
	}

	/**
	 * The writes of `update`, inside its transaction.
	 * @param tx The open transaction.
	 * @param id Product id.
	 * @param shopId Shop it must belong to.
	 * @param d Validated (and sanitised) product input.
	 * @param userId Credited in stock_movements for stock typed into the form.
	 * @returns The updated product row, or null when it isn't this shop's.
	 */
	async #overwrite(
		tx: SQL,
		id: number,
		shopId: number,
		d: ProductInput,
		userId: number | null,
	) {
		const [before] =
			await tx`select stock from products where id = ${id} and shop_id = ${shopId}`;
		if (!before) return null;
		// absent = the form didn't touch it
		const stock = d.variants.length ? 0 : (d.stock ?? Number(before.stock));
		// Same name → same slug: only itself is left out of the collision check.
		// A rename moves the page.
		const [p] = await Db.update(
			tx,
			"products",
			tx`name = ${d.name}, slug = ${await this.#uniqueSlug(tx, shopId, d.name, id)}, description = ${d.description}, price = ${d.price}, purchase_price = ${d.purchase_price}, original_price = ${d.original_price}, images = ${this.#images(d)}, sku = ${d.sku}, barcode = ${d.barcode}, unit = ${d.unit}, amount = ${d.amount ?? null}, extra = coalesce(${d.extra ? this.#extra(d) : null}, extra),
        track_stock = ${d.track_stock}, stock = ${stock}, low_stock_at = ${d.low_stock_at}, featured = ${d.featured}, custom_request = coalesce(${d.custom_request ?? null}, custom_request), custom_request_label = coalesce(${d.custom_request_label ?? null}, custom_request_label), active = ${d.active}, kind = ${d.kind === "bundle" ? "bundle" : "item"}, updated_at = current_timestamp`,
			tx`id = ${id} and shop_id = ${shopId}`,
			tx`*`,
		);
		if (stock !== Number(before.stock))
			await this.#formMovement(
				tx,
				shopId,
				id,
				null,
				stock - Number(before.stock),
				userId,
			);
		await this.#syncRelations(tx, shopId, id, d, userId);
		return p as Product;
	}

	/**
	 * The writes of `delete`, inside its transaction.
	 * The child tables carry no shop_id.
	 * So it stops when the product is another shop's.
	 * @param tx The open transaction.
	 * @param id Product id.
	 * @param shopId Shop it must belong to.
	 */
	async #drop(tx: SQL, id: number, shopId: number) {
		const own =
			await tx`select 1 from products where id = ${id} and shop_id = ${shopId}`;
		if (!own.length) return;
		await tx`delete from stock_movements where product_id = ${id} and shop_id = ${shopId}`;
		// its own recipe; components are guarded in ProductService
		await tx`delete from bundle_items where bundle_id = ${id}`;
		await tx`delete from product_variants where product_id = ${id}`;
		await tx`delete from product_categories where product_id = ${id}`;
		await tx`delete from products where id = ${id} and shop_id = ${shopId}`;
	}
}
