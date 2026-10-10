import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

/**
 * Order history: what changed on an order after it was made, and when.
 * One row per change. Today: items added to, or removed from, an order that is not paid yet.
 *   type — what happened (`items_added` | `items_removed`)
 *   data — JSON `{ changed, before, after }`: the lines added or the units removed,
 *     then the order as it was and as it is now,
 *     each with its lines (name, qty, price) and its subtotal, discount, tax and total
 *   user_id — who did it
 *   created_at — when
 */
export async function up(db: SQL) {
	await db.unsafe(`create table order_history (
    id ${ID_PK},
    order_id integer not null,
    shop_id integer not null,
    user_id integer,
    type text not null,
    data text not null default '{}',
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create index idx_order_history_order on order_history (order_id)`,
	);
}
