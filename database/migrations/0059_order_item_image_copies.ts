import type { SQL } from "bun";
import { OrderImages } from "@xcore/storage/OrderImages";
import { ORDER_IMAGE_PREFIX } from "@constants/Storage.Constant";

/**
 * Give every old order line its own picture.
 * 0058 stored the product's picture path, but a product may now delete its pictures.
 * Each distinct product path is copied once per shop (into the shop's `orders` folder, shrunk) and its lines point at the copy.
 * A picture that can't be copied (file gone) leaves the line with none. Lines that already
 * have an order copy are left alone, so a second run does nothing.
 * @param db The connection.
 */
export async function up(db: SQL) {
	const rows: { image: string; shop_id: number }[] = await db.unsafe(
		`select distinct i.image, o.shop_id from order_items i join orders o on o.id = i.order_id
		where i.image is not null and i.image not like '/uploads/${ORDER_IMAGE_PREFIX}%' and i.image not like '/uploads/%/orders/%'`,
	);
	for (const { image, shop_id } of rows) {
		const copy = await OrderImages.copy(image, shop_id);
		await db`update order_items set image = ${copy}
			where image = ${image} and order_id in (select id from orders where shop_id = ${shop_id})`;
	}
}
