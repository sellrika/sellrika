import {
	ORDER_IMAGE_CACHE_MAX,
	ORDER_IMAGE_PX,
} from "@constants/Storage.Constant";
import { drive, Storage } from "@xcore/storage/Storage";

/**
 * What is remembered about the order copy of one product picture.
 */
type Kept = {
	/** The copy's path, once it is made. Null when it could not be made. */
	copy: Promise<string | null>;
	/**
	 * True while only the checkout that made the copy got it.
	 * Only such a copy may be deleted when that order is refused.
	 */
	fresh: boolean;
};

/**
 * An order's own copies of the product pictures.
 * They are never shared with products and never deleted with them.
 * Order lines may share one copy: order pictures are never deleted.
 */
export class OrderImages {
	/**
	 * The order copy of each product picture sold lately,
	 * by shop id and picture path.
	 * So the same picture is not read and shrunk again on every sale.
	 * It holds `ORDER_IMAGE_CACHE_MAX` entries at most, the oldest goes first.
	 * In this process only: after a restart a picture is copied once more.
	 */
	static #copies = new Map<string, Kept>();

	/**
	 * Is this an order line's own picture?
	 * `/uploads/<shop id>/orders/…`, or an older `/uploads/order-…`.
	 * These are never shared with products and never deleted with them.
	 * @param url A stored image path.
	 * @returns True for an order picture.
	 */
	static is(url: string): boolean {
		return Storage.isOrderImage(url);
	}

	/**
	 * Save an order line's picture in the shop's `orders` folder,
	 * through the storage driver.
	 * @param bytes The picture (already shrunk by the caller).
	 *   Sniffed; anything that isn't an image is refused.
	 * @param shopId The order's shop.
	 * @returns The `/uploads/<shop id>/orders/<uuid>.<ext>` path.
	 *   Null when the bytes are not an image.
	 */
	static put(bytes: Uint8Array, shopId: number): Promise<string | null> {
		return Storage.put(bytes, shopId, "orders");
	}

	/**
	 * The order's own copy of a product picture.
	 * The first sale of a picture makes the copy (`#make`).
	 * Later sales get that same copy, with no file read or written.
	 * The product may delete its picture later;
	 * the orders keep the copy for good.
	 * Never throws: a missing file or a driver error is logged and gives null.
	 * @param url The product picture's `/uploads/…` path, or null.
	 * @param shopId The order's shop.
	 * @returns The `/uploads/<shop id>/orders/…` path.
	 *   Null when there is nothing to copy.
	 */
	static async copy(
		url: string | null | undefined,
		shopId: number,
	): Promise<string | null> {
		if (!url) return null;
		const key = `${shopId}:${url}`;
		const kept = OrderImages.#copies.get(key);
		if (kept) {
			// somebody else has this copy too now: it must stay
			kept.fresh = false;
			return kept.copy;
		}
		const entry: Kept = { copy: OrderImages.#make(url, shopId), fresh: true };
		OrderImages.#copies.set(key, entry);
		if (OrderImages.#copies.size > ORDER_IMAGE_CACHE_MAX) {
			// a Map keeps the order things were added in: the first is the oldest
			const [oldest] = OrderImages.#copies.keys();
			if (oldest !== undefined) OrderImages.#copies.delete(oldest);
		}
		const copy = await entry.copy;
		// a failed copy is not remembered: the next sale tries again
		if (!copy && OrderImages.#copies.get(key) === entry)
			OrderImages.#copies.delete(key);
		return copy;
	}

	/**
	 * Swap each line's product picture for the order's own copy.
	 * The copies are made side by side.
	 * @param lines The order lines.
	 *   `image` holds the product picture's path (the copy's source).
	 * @param shopId The order's shop.
	 * @returns New lines whose `image` is the order copy, or null.
	 */
	static copyAll<T extends { image?: string | null }>(
		lines: T[],
		shopId: number,
	): Promise<T[]> {
		const copies: Promise<T>[] = [];
		for (const line of lines)
			copies.push(OrderImages.#copyLineImage(line, shopId));
		return Promise.all(copies);
	}

	/**
	 * Delete order pictures that never made it onto an order
	 * (the order was refused).
	 * Only a copy this checkout made itself is deleted.
	 * A copy another order may use is kept.
	 * `deleteUpload` refuses order pictures on purpose,
	 * so this goes to the driver itself.
	 * Never throws: a failure is logged.
	 * @param lines The lines `copyOrderImages` returned.
	 */
	static async drop(lines: { image?: string | null }[]): Promise<void> {
		for (const { image } of lines) {
			if (!image || !OrderImages.is(image)) continue;
			if (!(await OrderImages.#forgetFresh(image))) continue;
			try {
				await drive.use().delete(image.slice(1));
			} catch (e) {
				console.warn(`[orders] could not delete ${image}:`, e);
			}
		}
	}

	/**
	 * Forget a copy that only one checkout ever got.
	 * @param image The copy's path.
	 * @returns True when it was forgotten, so its file may be deleted.
	 *   False when it is not remembered, or another order may use it.
	 */
	static async #forgetFresh(image: string): Promise<boolean> {
		for (const [key, kept] of OrderImages.#copies) {
			if (!kept.fresh || (await kept.copy) !== image) continue;
			OrderImages.#copies.delete(key);
			return true;
		}
		return false;
	}

	/**
	 * Make an order's copy of a product picture:
	 * read it, shrink it, save it in the shop's `orders` folder.
	 * Never throws: a missing file or a driver error is logged and gives null.
	 * @param url The product picture's `/uploads/…` path.
	 * @param shopId The order's shop.
	 * @returns The new `/uploads/<shop id>/orders/…` path, or null.
	 */
	static async #make(url: string, shopId: number): Promise<string | null> {
		try {
			const file = await Storage.readBytes(url);
			if (!file) {
				console.warn(`[orders] picture ${url} is gone, the line keeps none`);
				return null;
			}
			return await OrderImages.put(
				(await Storage.shrink(file, ORDER_IMAGE_PX)).bytes,
				shopId,
			);
		} catch (e) {
			console.warn(`[orders] could not copy picture ${url}:`, e);
			return null;
		}
	}

	/**
	 * One line of `copyOrderImages`.
	 * @param line An order line with the product picture's path.
	 * @param shopId The order's shop.
	 * @returns The same line with the order's copy.
	 */
	static async #copyLineImage<T extends { image?: string | null }>(
		line: T,
		shopId: number,
	): Promise<T> {
		return { ...line, image: await OrderImages.copy(line.image, shopId) };
	}
}
