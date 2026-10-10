import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import type { StorePage } from "@models/StorePage";

/**
 * Custom storefront pages built in /online-store (About, Shipping, …).
 * One set per shop.
 */
@Service()
export class StorePageRepository {
	/**
	 * Every page of a shop, with body and CSS.
	 * @param shopId Owning shop.
	 * @returns Pages ordered by title.
	 */
	async all(shopId: number): Promise<StorePage[]> {
		return await sql`select * from store_pages where shop_id = ${shopId} order by title`;
	}

	/**
	 * One page by id.
	 * @param id Page id.
	 * @param shopId Shop it must belong to.
	 * @returns The page, or null.
	 */
	async find(id: number, shopId: number): Promise<StorePage | null> {
		return Db.one(
			sql`select * from store_pages where id = ${id} and shop_id = ${shopId}`,
		);
	}

	/**
	 * One page by its public address.
	 * @param shopId Owning shop.
	 * @param slug The `/pages/<slug>` part of the URL.
	 * @returns The page, or null.
	 */
	async findBySlug(shopId: number, slug: string): Promise<StorePage | null> {
		return Db.one(
			sql`select * from store_pages where shop_id = ${shopId} and slug = ${slug}`,
		);
	}

	/**
	 * Just slug + title — the storefront footer links.
	 * @param shopId Owning shop.
	 * @returns One `{ slug, title }` per page.
	 */
	async links(shopId: number): Promise<{ slug: string; title: string }[]> {
		return await sql`select slug, title from store_pages where shop_id = ${shopId} order by title`;
	}

	/**
	 * Is this address already used by another page of the same shop?
	 * @param shopId Owning shop.
	 * @param slug Address to check.
	 * @param exceptId Page allowed to keep the slug (the one being edited).
	 * @returns True when taken.
	 */
	async slugTaken(shopId: number, slug: string, exceptId = 0) {
		return Db.exists(
			sql`select 1 from store_pages where shop_id = ${shopId} and slug = ${slug} and id <> ${exceptId}`,
		);
	}

	/**
	 * Create a page.
	 * @param shopId Owning shop.
	 * @param d Slug, title, sanitised body and CSS.
	 * @returns The created row.
	 */
	async create(
		shopId: number,
		d: { slug: string; title: string; body: string; css: string },
	): Promise<StorePage> {
		return (
			await sql`insert into store_pages (shop_id, slug, title, body, css) values (${shopId}, ${d.slug}, ${d.title}, ${d.body}, ${d.css}) returning *`
		)[0];
	}

	/**
	 * Overwrite a page.
	 * @param id Page id.
	 * @param shopId Shop it must belong to.
	 * @param d Slug, title, sanitised body and CSS.
	 */
	update(
		id: number,
		shopId: number,
		d: { slug: string; title: string; body: string; css: string },
	) {
		return sql`update store_pages set slug = ${d.slug}, title = ${d.title}, body = ${d.body}, css = ${d.css}, updated_at = current_timestamp where id = ${id} and shop_id = ${shopId}`;
	}

	/**
	 * Delete a page.
	 * @param id Page id.
	 * @param shopId Shop it must belong to.
	 */
	delete(id: number, shopId: number) {
		return sql`delete from store_pages where id = ${id} and shop_id = ${shopId}`;
	}
}
