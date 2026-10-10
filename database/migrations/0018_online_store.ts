import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";
import { slugify } from "@helpers/slug";

// Online storefront. Each shop can expose a public store at /store/<slug> rendered with one of the
// templates in app/validators/storeTemplates.ts. Stripe credentials live on the shop; the secret key
// is encrypted with APP_KEY (app/xcore/crypto.ts). store_carts snapshots a priced cart while the
// customer pays on Stripe Checkout; fulfilment turns it into an order (order_id set, 0 = in progress).
export async function up(db: SQL) {
	await db.unsafe(`alter table shops add column slug text`);
	await db.unsafe(
		`alter table shops add column online_enabled boolean not null default false`,
	);
	await db.unsafe(
		`alter table shops add column online_template text not null default 'classic'`,
	);
	await db.unsafe(`alter table shops add column stripe_publishable_key text`);
	await db.unsafe(`alter table shops add column stripe_secret_key text`);
	await db.unsafe(`create unique index idx_shops_slug on shops (slug)`);
	await db.unsafe(`create table store_carts (
    id ${ID_PK},
    shop_id integer not null references shops(id),
    payload text not null,
    stripe_session_id text,
    order_id integer,
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create index idx_store_carts_session on store_carts (stripe_session_id)`,
	);
	// backfill: every existing shop gets a slug from its name (the id keeps collisions unique)
	const shops: { id: number; name: string }[] = await db.unsafe(
		`select id, name from shops`,
	);
	const taken = new Set<string>();
	for (const s of shops) {
		let slug = slugify(s.name) || `shop-${s.id}`;
		if (taken.has(slug)) slug = `${slug}-${s.id}`;
		taken.add(slug);
		await db`update shops set slug = ${slug} where id = ${s.id}`;
	}
}
