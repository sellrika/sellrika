import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

// Customer accounts on the online store (sign in with email / Google / Microsoft through the shop's Firebase project):
//   shops.customer_logins   — comma list of the providers switched on (email, google, microsoft); '' = accounts off
//   shops.firebase_config   — JSON { api_key, auth_domain, project_id, app_id } of the shop's Firebase web app (public values —
//                             they ship to the browser; the API key also verifies sign-in tokens server-side, see Firebase.Api.ts)
//   customers.firebase_uid  — the Firebase user this customer record belongs to (null = never signed in)
//   customer_addresses      — the delivery addresses a customer keeps on their account (several, each with a label + phone)
//   customer_sessions       — one row per signed-in browser, keyed by the `csid` cookie (like `sessions` is for staff)
export async function up(db: SQL) {
	await db.unsafe(
		`alter table shops add column customer_logins text not null default ''`,
	);
	await db.unsafe(`alter table shops add column firebase_config text`);
	await db.unsafe(`alter table customers add column firebase_uid text`);
	await db.unsafe(
		`create index idx_customers_shop_uid on customers (shop_id, firebase_uid)`,
	);
	await db.unsafe(`create table customer_addresses (
    id ${ID_PK},
    customer_id integer not null,
    shop_id integer not null,
    label text not null default '',
    phone text not null default '',
    address_1 text not null,
    address_2 text not null default '',
    city text not null default '',
    state text not null default '',
    country text not null default '',
    postal_code text not null default '',
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create index idx_customer_addresses_customer on customer_addresses (customer_id)`,
	);
	await db.unsafe(`create table customer_sessions (
    id text primary key,
    customer_id integer not null,
    shop_id integer not null,
    expires_at timestamp not null
  )`);
}
