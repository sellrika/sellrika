import type { SQL } from "bun";

/**
 * Indexes for lookups that scanned a whole table.
 * Each line names the table, then the columns.
 */
const INDEXES = [
	// the abandoned-cart sweep and the reconcile job, per shop
	"idx_store_carts_shop_created on store_carts (shop_id, created_at)",
	// the clean-up of old carts, every shop at once
	"idx_store_carts_created on store_carts (created_at)",
	// "how many sold" and "is this product on an order"
	"idx_order_items_product on order_items (product_id)",
	// the checkout's State → City lists
	"postal_codes_country_admin1_place on postal_codes (country, admin1, place)",
	// the stock rows of one order (refund, void)
	"idx_stock_movements_order on stock_movements (order_id)",
	// a shop's code uses
	"idx_coupon_redemptions_shop on coupon_redemptions (shop_id)",
];

/**
 * Add the missing indexes.
 * `if not exists` works on SQLite and Postgres.
 * @param db The connection the migration runs on.
 */
export async function up(db: SQL) {
	for (const index of INDEXES)
		await db.unsafe(`create index if not exists ${index}`);
}
