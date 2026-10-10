import type { SQL } from "bun";

// Custom storefront domain. When a request's Host matches shops.domain the store is served at the
// root of that domain (/, /pages/<page>, /checkout, /done) instead of /store/<slug>.
// DNS and SSL are the merchant's job — we only match the hostname.
export async function up(db: SQL) {
	await db.unsafe(`alter table shops add column domain text`);
	await db.unsafe(`create unique index idx_shops_domain on shops (domain)`);
}
