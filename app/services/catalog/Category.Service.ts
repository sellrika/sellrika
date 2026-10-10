import { Service } from "@xcore/di";
import { t } from "@xcore/i18n/I18n";
import { Storage } from "@xcore/storage/Storage";
import { CategoryRepository } from "@repositories/Category.Repository";
import { UploadCleaner } from "@services/Upload.Service";
import type { CategoryInput } from "@validators/Category.Validator";

/**
 * Categories belong to a shop.
 * The only rule: a category's picture is always our own upload.
 */
@Service()
export class CategoryService {
	constructor(
		private categories: CategoryRepository,
		private cleaner: UploadCleaner,
	) {}

	/**
	 * Every category of a shop with its product count.
	 * @param shopId Owning shop.
	 * @returns Categories in display order.
	 */
	list(shopId: number) {
		return this.categories.allForShop(shopId);
	}

	/**
	 * Copy the picture into our storage when it is a link or base64.
	 * `d.image` is swapped for our `/uploads/…` URL.
	 * Run it before `create` and `update`.
	 * @param shopId The shop the picture belongs to.
	 * @param d Validated category input. Changed in place.
	 * @returns Inertia-style errors when the picture can't be stored, or null.
	 */
	async copyImage(shopId: number, d: CategoryInput) {
		const src = d.image;
		if (!src || Storage.isUploadUrl(src)) return null;
		const link = Storage.isHttpsImageUrl(src);
		const r = link
			? await Storage.storeImageFromUrl(src, shopId, "categories")
			: await Storage.storeImageFromData(src, shopId, "categories");
		if ("error" in r)
			return {
				image: t("server.image_copy_failed", {
					error: r.error,
					// base64 is far too long to show
					url: link ? src : "base64",
				}),
			};
		d.image = r.url;
		return null;
	}

	/**
	 * Create a category.
	 * @param shopId Owning shop.
	 * @param d Validated name, colour and picture.
	 * @returns The created category.
	 */
	create(shopId: number, d: CategoryInput) {
		return this.categories.create(shopId, d);
	}

	/**
	 * Edit a category.
	 * @param id Category id.
	 * @param shopId Shop it must belong to.
	 * @param d Validated name, colour and picture.
	 * @returns The updated category, or null.
	 */
	async update(id: number, shopId: number, d: CategoryInput) {
		const before = await this.categories.find(id, shopId);
		const category = await this.categories.update(id, shopId, d);
		// a replaced or removed picture leaves storage too
		if (category && before?.image !== category.image)
			await this.#dropImage(before?.image ?? null);
		return category;
	}

	/**
	 * Delete a category (its products keep existing, uncategorised).
	 * @param id Category id.
	 * @param shopId Shop it must belong to.
	 */
	async remove(id: number, shopId: number) {
		const before = await this.categories.find(id, shopId);
		await this.categories.delete(id, shopId);
		await this.#dropImage(before?.image ?? null);
	}

	/**
	 * Delete a category's picture once nothing uses it any more.
	 * Run it after the database change is saved.
	 * Never throws: a failure is logged and the save stays done.
	 * @param url The picture the category just stopped using, or null.
	 */
	async #dropImage(url: string | null) {
		if (!url) return;
		await this.cleaner.dropUnused([url], "categories");
	}
}
