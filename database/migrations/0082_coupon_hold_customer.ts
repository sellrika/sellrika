import type { SQL } from "bun";

/**
 * A checkout that holds a discount code now also says which signed-in
 * customer holds it (`store_carts.coupon_customer_id`, null = a guest).
 * A proven customer's per-customer limit counts only their own holds,
 * so a guest who types their email can not hold the code for them.
 * @param db The connection the migration runs on.
 */
export async function up(db: SQL) {
	await db.unsafe(
		`alter table store_carts add column coupon_customer_id integer`,
	);
}
