import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

/**
 * Marketing (docs/features/marketing.md).
 * `shops.abandoned_cart` = the abandoned-cart email is on.
 * `shops.abandoned_cart_hours` = how long after the checkout it goes out.
 * `store_carts.reminded_at` = when the reminder was claimed (one per cart).
 * `store_carts.restore_token` = the random key of its "Complete your order" link.
 * `email_unsubscribes` = who said "no more emails" to a shop, by email.
 * `campaigns` = the emails an owner writes to picked customers.
 * `campaign_sends` = one row per recipient, written before the send,
 * so a crash mid-send never emails anyone twice.
 */
export async function up(db: SQL) {
	await db.unsafe(
		`alter table shops add column abandoned_cart boolean not null default false`,
	);
	await db.unsafe(
		`alter table shops add column abandoned_cart_hours integer not null default 4`,
	);
	await db.unsafe(`alter table store_carts add column reminded_at timestamp`);
	await db.unsafe(`alter table store_carts add column restore_token text`);
	await db.unsafe(
		`create unique index idx_store_carts_restore on store_carts (restore_token)`,
	);
	await db.unsafe(`create table email_unsubscribes (
    id ${ID_PK},
    shop_id integer not null references shops(id),
    email text not null,
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create unique index idx_email_unsubscribes on email_unsubscribes (shop_id, email)`,
	);
	await db.unsafe(`create table campaigns (
    id ${ID_PK},
    shop_id integer not null references shops(id),
    subject text not null default '',
    body text not null default '',
    product_ids text not null default '[]',
    customer_ids text not null default '[]',
    status text not null default 'draft',
    send_at timestamp,
    sent integer not null default 0,
    failed integer not null default 0,
    created_by integer,
    created_at timestamp not null default current_timestamp,
    updated_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(`create index idx_campaigns_shop on campaigns (shop_id)`);
	await db.unsafe(`create table campaign_sends (
    id ${ID_PK},
    campaign_id integer not null references campaigns(id),
    customer_id integer not null,
    email text not null,
    sent_at timestamp,
    error text,
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create unique index idx_campaign_sends on campaign_sends (campaign_id, customer_id)`,
	);
}
