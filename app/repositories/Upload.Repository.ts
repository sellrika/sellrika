import { Service } from "@xcore/di";
import { sql } from "@xcore/database/Database";
import { Storage } from "@xcore/storage/Storage";

/** Questions about uploaded files (`/uploads/…`) that span every table. */
@Service()
export class UploadRepository {
	/**
	 * Does anything still use this file? Checked across all shops.
	 * JSON lists match the quoted path.
	 * So `/uploads/a.jpg` never matches `/uploads/a.jpg2`.
	 * Rich text and CSS match the bare path.
	 * A false match only keeps a file, it never deletes one.
	 * An order picture always counts as used, without a query:
	 * an order keeps its picture for good.
	 * `order_items` is not searched for other paths.
	 * It only ever stores an order's own copy
	 * (`OrderRepository.#ownImage`, migration 0059 for older lines).
	 * Not narrowed to the shop in the path:
	 * a product of one shop may point at another shop's picture.
	 * @param url A `/uploads/<name>` path.
	 * @returns True when any row still points at it.
	 */
	async inUse(url: string): Promise<boolean> {
		if (Storage.isOrderImage(url)) return true;
		const quoted = `%"${url}"%`;
		const bare = `%${url}%`;
		const rows = await sql`
			select 1 from products where images like ${quoted} or description like ${bare}
			union all select 1 from product_variants where images like ${quoted}
			union all select 1 from shops where logo = ${url}
			union all select 1 from store_pages where body like ${bare} or css like ${bare}
			union all select 1 from campaigns where body like ${bare}
			union all select 1 from shop_extensions where config like ${quoted}
			union all select 1 from settings where value like ${quoted}
			union all select 1 from payment_methods where image = ${url}
			union all select 1 from categories where image = ${url}
			union all select 1 from store_carts where order_id is null and payload like ${quoted}
			limit 1`;
		return rows.length > 0;
	}
}
