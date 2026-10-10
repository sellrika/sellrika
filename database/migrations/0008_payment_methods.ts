import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

// Per-shop payment methods (name + lucide icon + color + "asks for tendered amount"). orders.payment_method keeps
// the method *name* as text, so history survives renames/deletes. Existing shops get Cash/Card/Other and old
// lowercase order values are mapped onto those names.
export async function up(db: SQL) {
	await db.unsafe(`create table payment_methods (
    id ${ID_PK},
    shop_id integer not null references shops(id),
    name text not null,
    icon text not null default 'Wallet',
    color text,
    tendered boolean not null default false,
    position integer not null default 0,
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`insert into payment_methods (shop_id, name, icon, color, tendered, position) select id, 'Cash', 'Banknote', '#22c55e', true, 0 from shops`,
	);
	await db.unsafe(
		`insert into payment_methods (shop_id, name, icon, color, tendered, position) select id, 'Card', 'CreditCard', '#3b82f6', false, 1 from shops`,
	);
	await db.unsafe(
		`insert into payment_methods (shop_id, name, icon, color, tendered, position) select id, 'Other', 'Wallet', '#f59e0b', false, 2 from shops`,
	);
	await db.unsafe(
		`update orders set payment_method = 'Cash' where payment_method = 'cash'`,
	);
	await db.unsafe(
		`update orders set payment_method = 'Card' where payment_method = 'card'`,
	);
	await db.unsafe(
		`update orders set payment_method = 'Other' where payment_method = 'other'`,
	);
}
