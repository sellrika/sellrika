import type { SQL } from "bun";
import { Service } from "@xcore/di";
import { sql } from "@xcore/database/Database";
import { Paginate } from "@xcore/http/Paginate";
import type {
	StockItem,
	StockMovement,
	StockMovementType,
	StockUnit,
} from "@models/Stock";
import { parseJson } from "@helpers/json";
import { catalogChanged } from "@helpers/catalogVersion";
import { TtlCache } from "@helpers/TtlCache";
import { LOW_STOCK_CACHE_MS } from "@constants/Stock.Constant";

/** One change of a unit's stock. */
export type Move = {
	shopId: number;
	productId: number;
	variantId: number | null;
	type: StockMovementType;
	/** Signed: minus takes stock out. */
	qty: number;
	reason?: string;
	orderId?: number | null;
	userId?: number | null;
};

/** A Stock page row before its picture and counts are worked out. */
type StockItemRow = Omit<StockItem, "image" | "stock" | "low_stock_at"> & {
	images: string | string[] | null;
	stock: unknown;
	low_stock_at: unknown;
};

/**
 * The sidebar's low-stock number, kept per shop for a short time.
 */
const low = new TtlCache<number, number>(LOW_STOCK_CACHE_MS);

/**
 * Inventory ledger.
 * Every change = one row in stock_movements
 * + the running total on products.stock / product_variants.stock.
 * Writes take the transaction they run in (`tx`),
 * so a checkout/refund is all-or-nothing.
 */
@Service()
export class StockRepository {
	/**
	 * Forget a shop's kept low-stock number.
	 * Call it after stock moved or a product's stock settings changed.
	 * @param shopId Owning shop.
	 */
	static forgetLow(shopId: number) {
		low.delete(shopId);
	}

	/**
	 * Apply a signed movement to a *tracked* unit.
	 * The guard is in the UPDATE's WHERE.
	 * So two concurrent sales can't both take the last unit.
	 * @param tx Transaction to run in.
	 * @param m The movement: which unit, which type, signed quantity,
	 *   and who/why.
	 * @returns False (and nothing written) when the unit isn't tracked anymore
	 *   or doesn't exist, or when taking stock out would go below zero.
	 */
	async move(tx: SQL, m: Move): Promise<boolean> {
		const floor = m.qty < 0 ? -m.qty : 0;
		const rows =
			m.variantId == null
				? await tx`update products set stock = stock + ${m.qty} where id = ${m.productId} and shop_id = ${m.shopId} and track_stock = ${true} and stock >= ${floor} returning id`
				: await tx`update product_variants set stock = stock + ${m.qty} where id = ${m.variantId} and product_id = ${m.productId} and stock >= ${floor}
          and exists (select 1 from products p where p.id = ${m.productId} and p.shop_id = ${m.shopId} and p.track_stock = ${true}) returning id`;
		if (!rows.length) return false;
		StockRepository.forgetLow(m.shopId);
		// ponytail: bumped before the commit. A store page loaded in that
		// gap may show the old count for up to STORE_CATALOG_TTL_MS.
		// The checkout reads stock from the database, so no oversell.
		catalogChanged(m.shopId);
		await tx`insert into stock_movements (shop_id, product_id, variant_id, type, qty, reason, order_id, user_id)
      values (${m.shopId}, ${m.productId}, ${m.variantId}, ${m.type}, ${m.qty}, ${m.reason ?? ""}, ${m.orderId ?? null}, ${m.userId ?? null})`;
		return true;
	}

	/**
	 * The newest movement id of a shop.
	 * Take it before a write, then `since()` lists what the write added.
	 * @param shopId Owning shop.
	 * @returns The id, 0 when the ledger is empty.
	 */
	async lastId(shopId: number): Promise<number> {
		return Number(
			(
				await sql`select coalesce(max(id), 0) as n from stock_movements where shop_id = ${shopId}`
			)[0].n,
		);
	}

	/**
	 * Movements written after a mark, narrowed to one order or one unit.
	 * So a concurrent sale's rows stay out.
	 * @param shopId Owning shop.
	 * @param afterId The mark from `lastId()`.
	 * @param f `orderId` = the order's rows;
	 *   `productId` (+ `variantId`) = the unit's rows.
	 * @returns The rows, oldest first.
	 */
	async since(
		shopId: number,
		afterId: number,
		f: { orderId?: number; productId?: number; variantId?: number | null } = {},
	): Promise<StockMovement[]> {
		return sql`select * from stock_movements where shop_id = ${shopId} and id > ${afterId}
      ${f.orderId ? sql`and order_id = ${f.orderId}` : sql``}
      ${f.productId ? sql`and product_id = ${f.productId} and coalesce(variant_id, 0) = ${f.variantId ?? 0}` : sql``}
      order by id`;
	}

	/**
	 * A unit's names and count right now, for the `stock.updated` payload.
	 * @param shopId Owning shop.
	 * @param productId Product id.
	 * @param variantId Variant id, or null for the product itself.
	 * @returns The unit, or null if it is not this shop's.
	 */
	async unit(
		shopId: number,
		productId: number,
		variantId: number | null,
	): Promise<StockUnit | null> {
		const [r] =
			variantId == null
				? await sql`select p.name, null as variant, p.stock, p.low_stock_at from products p where p.id = ${productId} and p.shop_id = ${shopId}`
				: await sql`select p.name, v.name as variant, v.stock, p.low_stock_at from product_variants v join products p on p.id = v.product_id where v.id = ${variantId} and p.id = ${productId} and p.shop_id = ${shopId}`;
		return r
			? {
					name: r.name,
					variant: r.variant ?? null,
					stock: Number(r.stock),
					low_stock_at: Number(r.low_stock_at),
				}
			: null;
	}

	/**
	 * Current on-hand count of a unit.
	 * @param tx Transaction to run in.
	 * @param shopId Owning shop.
	 * @param productId Product id.
	 * @param variantId Variant id, or null for the product itself.
	 * @returns The count, or null if the unit doesn't exist in this shop.
	 */
	async level(
		tx: SQL,
		shopId: number,
		productId: number,
		variantId: number | null,
	): Promise<number | null> {
		const [r] =
			variantId == null
				? await tx`select stock from products where id = ${productId} and shop_id = ${shopId}`
				: await tx`select v.stock from product_variants v join products p on p.id = v.product_id where v.id = ${variantId} and p.id = ${productId} and p.shop_id = ${shopId}`;
		return r ? Number(r.stock) : null;
	}

	/**
	 * Tracked units for the Stock page.
	 * Products without variants + every variant of a tracked product.
	 * @param shopId Owning shop.
	 * @param filter all | low (stock <= low_stock_at, includes out)
	 *   | out (stock <= 0).
	 * @param q Matches product/variant name or barcode ("" = no filter).
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of stock units.
	 */
	async pageForShop(
		shopId: number,
		filter: "all" | "low" | "out",
		q: string,
		page: number,
		perPage: number,
	) {
		const like = `%${q.toLowerCase()}%`;
		// one row per unit; variants inherit the product's threshold
		const units = sql`select p.id as product_id, null as variant_id, p.name, null as variant_name, p.images, p.barcode, p.stock, p.low_stock_at, p.name as sort_name, 0 as sort_pos
        from products p where p.shop_id = ${shopId} and p.track_stock = ${true} and not exists (select 1 from product_variants v where v.product_id = p.id)
      union all
      select p.id, v.id, p.name, v.name, coalesce(nullif(v.images, '[]'), p.images), v.barcode, v.stock, p.low_stock_at, p.name, v.position
        from product_variants v join products p on p.id = v.product_id where p.shop_id = ${shopId} and p.track_stock = ${true}`;
		const where = sql`where (${filter} = 'all' or (${filter} = 'low' and u.stock <= u.low_stock_at) or (${filter} = 'out' and u.stock <= 0))
      and (${q} = '' or lower(u.name) like ${like} or lower(coalesce(u.variant_name, '')) like ${like} or lower(coalesce(u.barcode, '')) like ${like})`;
		const [{ n }] = await sql`select count(*) as n from (${units}) u ${where}`;
		const rows: StockItemRow[] =
			await sql`select * from (${units}) u ${where} order by u.sort_name, u.product_id, u.sort_pos, u.variant_id ${Paginate.limit(page, perPage)}`;
		const items = rows.map((r) => this.#item(r));
		return Paginate.of(items, Number(n), page, perPage);
	}

	/**
	 * Counts for the Stock page header / Reports.
	 * @param shopId Owning shop.
	 * @returns How many units are tracked, how many are low (incl. out)
	 *   and how many are out.
	 */
	async summary(shopId: number) {
		const [r] =
			await sql`select count(*) as n, coalesce(sum(case when stock <= low_stock_at then 1 else 0 end), 0) as low, coalesce(sum(case when stock <= 0 then 1 else 0 end), 0) as out from (
        select p.stock, p.low_stock_at from products p where p.shop_id = ${shopId} and p.track_stock = ${true} and not exists (select 1 from product_variants v where v.product_id = p.id)
        union all
        select v.stock, p.low_stock_at from product_variants v join products p on p.id = v.product_id where p.shop_id = ${shopId} and p.track_stock = ${true}) u`;
		return { tracked: Number(r.n), low: Number(r.low), out: Number(r.out) };
	}

	/**
	 * How many units are low (incl. out), for the sidebar badge.
	 * Every staff page asks, so the number is kept in memory for a short time.
	 * @param shopId Owning shop.
	 * @returns The count.
	 */
	lowCount(shopId: number): Promise<number> {
		return low.get(shopId, () => this.#readLow(shopId));
	}

	/**
	 * Movement history of one unit, newest first.
	 * Each row says who did it and which order it belongs to.
	 * @param shopId Owning shop.
	 * @param productId Product id.
	 * @param variantId Variant id, or null for the product itself.
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of movements.
	 */
	async movements(
		shopId: number,
		productId: number,
		variantId: number | null,
		page: number,
		perPage: number,
	) {
		const where =
			variantId == null
				? sql`where m.shop_id = ${shopId} and m.product_id = ${productId} and m.variant_id is null`
				: sql`where m.shop_id = ${shopId} and m.product_id = ${productId} and m.variant_id = ${variantId}`;
		const [{ n }] =
			await sql`select count(*) as n from stock_movements m ${where}`;
		const rows: (StockMovement & { by: string | null })[] =
			await sql`select m.*, u.name as by from stock_movements m left join users u on u.id = m.user_id ${where}
      order by m.id desc ${Paginate.limit(page, perPage)}`;
		return Paginate.of(rows, Number(n), page, perPage);
	}
	/**
	 * Count the low units (the slow part of `lowCount`).
	 * @param shopId Owning shop.
	 * @returns The count.
	 */
	async #readLow(shopId: number): Promise<number> {
		return (await this.summary(shopId)).low;
	}

	/**
	 * One row of the Stock page.
	 * The picture is the first of the unit's images.
	 * @param r The raw row.
	 * @returns The unit with its counts as numbers.
	 */
	#item(r: StockItemRow): StockItem {
		return {
			product_id: r.product_id,
			variant_id: r.variant_id,
			name: r.name,
			variant_name: r.variant_name,
			image: parseJson<string[] | null>(r.images, null)?.[0] ?? null,
			barcode: r.barcode,
			stock: Number(r.stock),
			low_stock_at: Number(r.low_stock_at),
		};
	}
}
