import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

// Packages ("bundles"): a product of kind 'bundle' is a recipe of other products instead of a thing on a shelf.
// Each bundle_items row is one slot — `qty` × the component product, filled by one of `variant_ids`
// (JSON number[]; null = the component has no variants). A package has no stock/variants/cost of its own:
// availability and cost are derived from the components, so nothing here duplicates them.
// order_items.components snapshots what a sold package took, so refunds/voids put the same units back.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table products add column kind text not null default 'item'`,
	);
	await db.unsafe(`create table bundle_items (
    id ${ID_PK},
    bundle_id integer not null references products(id),
    product_id integer not null references products(id),
    variant_ids text,
    qty integer not null default 1
  )`);
	await db.unsafe(
		`create index idx_bundle_items_bundle on bundle_items (bundle_id)`,
	);
	await db.unsafe(`alter table order_items add column components text`);
}
