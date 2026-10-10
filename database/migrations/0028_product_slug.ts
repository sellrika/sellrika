import type { SQL } from "bun";
import { slugify } from "@helpers/slug";

// Products get a URL slug for their storefront page (/store/<shop>/p/<slug>) — unique per shop,
// derived from the name by ProductRepository on every create/update (a rename moves the page).
export async function up(db: SQL) {
	await db.unsafe(`alter table products add column slug text`);
	// backfill: every existing product gets a slug from its name (the id keeps collisions unique)
	const rows: { id: number; shop_id: number; name: string }[] =
		await db`select id, shop_id, name from products order by id`;
	const taken = new Set<string>();
	for (const p of rows) {
		let slug = slugify(p.name) || `p-${p.id}`;
		if (taken.has(`${p.shop_id}/${slug}`)) slug = `${slug}-${p.id}`;
		taken.add(`${p.shop_id}/${slug}`);
		await db`update products set slug = ${slug} where id = ${p.id}`;
	}
	await db.unsafe(
		`create unique index idx_products_slug on products (shop_id, slug)`,
	);
}
