import type { SQL } from "bun";
import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import type { Category } from "@models/Category";
import type { CategoryInput } from "@validators/Category.Validator";
import { catalogChanged } from "@helpers/catalogVersion";

/** Product categories — one set per shop. */
@Service()
export class CategoryRepository {
	/**
	 * Every category of a shop, in display order.
	 * Each one says how many products it holds.
	 * @param shopId Shop to list.
	 * @returns Categories with a `product_count`.
	 */
	allForShop(
		shopId: number,
	): Promise<(Category & { product_count: number })[]> {
		return sql`select c.*, (select count(*) from product_categories pc where pc.category_id = c.id) as product_count
        from categories c where c.shop_id = ${shopId} order by c.position, c.name`;
	}

	/**
	 * One category of this shop.
	 * @param id Category id.
	 * @param shopId Shop it must belong to.
	 * @returns The category, or null.
	 */
	async find(id: number, shopId: number): Promise<Category | null> {
		return Db.one(
			sql`select * from categories where id = ${id} and shop_id = ${shopId}`,
		);
	}

	/**
	 * Create a category.
	 * @param shopId Owning shop.
	 * @param d Validated name, colour and picture.
	 * @returns The created row.
	 */
	async create(shopId: number, d: CategoryInput): Promise<Category> {
		const rows = await Db.insert(
			sql,
			"categories",
			sql`insert into categories (shop_id, name, color, image) values (${shopId}, ${d.name}, ${d.color}, ${d.image})`,
		);
		catalogChanged(shopId);
		return rows[0];
	}

	/**
	 * Rename / recolour a category of this shop.
	 * @param id Category id.
	 * @param shopId Shop it must belong to.
	 * @param d Validated name, colour and picture.
	 * @returns The updated row, or null when it doesn't belong to this shop.
	 */
	async update(
		id: number,
		shopId: number,
		d: CategoryInput,
	): Promise<Category | null> {
		const row = await Db.one<Category>(
			Db.update(
				sql,
				"categories",
				sql`name = ${d.name}, color = ${d.color}, image = ${d.image}`,
				sql`id = ${id} and shop_id = ${shopId}`,
				sql`*`,
			),
		);
		catalogChanged(shopId);
		return row;
	}

	/**
	 * Delete a category and unlink it from every product.
	 * The products stay.
	 * @param id Category id.
	 * @param shopId Shop it must belong to.
	 */
	async delete(id: number, shopId: number) {
		await sql.begin((tx) => this.#drop(tx, id, shopId));
		// the store's products carry their category ids
		catalogChanged(shopId);
	}

	/**
	 * The writes of `delete`, inside its transaction.
	 * `product_categories` carries no shop_id.
	 * So it stops when the category is another shop's.
	 * @param tx The open transaction.
	 * @param id Category id.
	 * @param shopId Shop it must belong to.
	 */
	async #drop(tx: SQL, id: number, shopId: number) {
		const gone = await Db.delete(
			tx,
			"categories",
			tx`id = ${id} and shop_id = ${shopId}`,
		);
		if (!gone) return;
		await tx`delete from product_categories where category_id = ${id}`;
	}
}
