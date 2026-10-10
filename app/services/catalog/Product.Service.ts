import { t } from "@xcore/i18n/I18n";
import { Storage } from "@xcore/storage/Storage";
import type { ProductSort } from "@constants/Product.Constant";
import { Service } from "@xcore/di";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import { PlanLimitService } from "@services/settings/PlanLimit.Service";
import { ProductRepository } from "@repositories/Product.Repository";
import { StockRepository } from "@repositories/Stock.Repository";
import { UploadCleaner } from "@services/Upload.Service";
import { CategoryRepository } from "@repositories/Category.Repository";
import { sanitizeHtml } from "@helpers/html";
import { ProductInput } from "@validators/Product.Validator";
import { validate } from "@validators/validate";

/**
 * The catalogue.
 * Sanitising writes, and the rules that keep barcodes
 * and package recipes consistent.
 */
@Service()
export class ProductService {
	constructor(
		private products: ProductRepository,
		private categories: CategoryRepository,
		private extensions: ExtensionService,
		private cleaner: UploadCleaner,
		private limits: PlanLimitService,
	) {}

	/**
	 * The picture clean-ups started by saves, one after the other.
	 * A save does not wait for them.
	 */
	#cleanup: Promise<void> = Promise.resolve();

	/**
	 * Wait until every picture clean-up started so far is done.
	 * Tests use it. A save never waits.
	 * @returns A promise that ends when the files are gone.
	 */
	picturesDropped(): Promise<void> {
		return this.#cleanup;
	}

	/**
	 * Is there room for one more product in the shop?
	 * @param shopId The shop.
	 * @returns An error under `name` when the shop is full, else null.
	 */
	async limitErrors(shopId: number) {
		if ((await this.limits.productsLeft(shopId)) > 0) return null;
		return { name: await this.limits.productError(shopId) };
	}

	/**
	 * Delete the pictures nothing uses any more.
	 * Run it after the database change is saved.
	 * Never throws: a failure is logged and the save stays done.
	 * @param urls The pictures the product just stopped using.
	 */
	async dropPictures(urls: Iterable<string>) {
		await this.cleaner.dropUnused(urls, "products");
	}

	/**
	 * Every category a product joins must belong to the same shop.
	 * A product can never point at another shop's category.
	 * @param shopId Owning shop.
	 * @param d Validated product input.
	 * @returns Inertia-style errors, or null when every id is the shop's own.
	 */
	async categoryErrors(shopId: number, d: ProductInput) {
		if (!d.category_ids.length) return null;
		const own = new Set(
			(await this.categories.allForShop(shopId)).map((c) => c.id),
		);
		return d.category_ids.every((id) => own.has(id))
			? null
			: { category_ids: t("server.product_category_missing") };
	}

	/**
	 * The whole catalogue of a shop.
	 * @param shopId Owning shop.
	 * @returns Every product, packages resolved.
	 */
	list(shopId: number) {
		return this.products.allForShop(shopId);
	}

	/**
	 * What a package may contain.
	 * A package can't contain another package.
	 * @param shopId Owning shop.
	 * @returns Only plain items, with just what the package editor shows.
	 */
	components(shopId: number) {
		return this.products.components(shopId);
	}

	/**
	 * One page of products.
	 * @param shopId Owning shop.
	 * @param q Search text ("" = everything).
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @param f Extra filters.
	 * `category` id, an explicit `ids` list,
	 * `active` = switched-on products only,
	 * `sold` = add the units sold,
	 * `sort` = a column and direction (the admin list).
	 * @returns A page of products.
	 */
	page(
		shopId: number,
		q: string,
		page: number,
		perPage: number,
		f: {
			category?: number | null;
			ids?: number[];
			active?: boolean;
			sold?: boolean;
			sort?: ProductSort | null;
		} = {},
	) {
		return this.products.pageForShop(shopId, q, page, perPage, f);
	}

	/**
	 * One product with variants, categories and package slots.
	 * @param id Product id.
	 * @param shopId Shop it must belong to.
	 * @returns The product, or null.
	 */
	find(id: number, shopId: number) {
		return this.products.find(id, shopId);
	}

	/**
	 * Barcodes must be unique per shop, and can't repeat inside one form either.
	 * @param shopId Owning shop.
	 * @param d Validated product input.
	 * @param exceptProductId Product allowed to keep its barcodes.
	 * It is the one being edited.
	 * @returns Inertia-style errors keyed by field.
	 * Null when everything is fine.
	 */
	async barcodeErrors(shopId: number, d: ProductInput, exceptProductId = 0) {
		const fields: [string, string | null][] = [
			["barcode", d.variants.length ? null : d.barcode],
			...d.variants.map(
				(v, i) =>
					[`variants.${i}.barcode`, v.barcode] as [string, string | null],
			),
		];
		const errors: Record<string, string> = {};
		const seen = new Set<string>();
		for (const [field, code] of fields) {
			if (!code) continue;
			const owner = seen.has(code)
				? null
				: await this.products.barcodeOwner(shopId, code, exceptProductId);
			if (seen.has(code)) errors[field] = t("server.product_duplicate_barcode");
			else if (owner)
				errors[field] = t("server.product_barcode_taken", { name: owner });
			seen.add(code);
		}
		return Object.keys(errors).length ? errors : null;
	}

	/**
	 * A package's contents must exist and must not be packages themselves.
	 * They must name real variants.
	 * The same slot twice is allowed on purpose.
	 * "6 × Mug (Red|Green)" + "6 × Mug (Red|Green)" is how
	 * a customer takes 6 red + 6 green.
	 * @param shopId Owning shop.
	 * @param d Validated product input.
	 * @param exceptProductId The product being edited.
	 * It can't be its own component.
	 * @returns Inertia-style errors.
	 * Null when it's fine or not a package at all.
	 */
	async bundleErrors(shopId: number, d: ProductInput, exceptProductId = 0) {
		if (d.kind !== "bundle") return null;
		if (!d.bundle_items.length)
			return { bundle_items: t("server.package_needs_item") };
		const errors: Record<string, string> = {};
		for (const [i, it] of d.bundle_items.entries()) {
			const comp =
				it.product_id === exceptProductId
					? null
					: await this.products.component(shopId, it.product_id);
			if (!comp) {
				errors[`bundle_items.${i}.product_id`] = t(
					"server.package_item_missing",
				);
				continue;
			}
			if (comp.kind === "bundle") {
				errors[`bundle_items.${i}.product_id`] = t("server.package_no_nesting");
				continue;
			}
			const chosen = it.variant_ids ?? [];
			if (comp.variant_ids.length && !chosen.length) {
				errors[`bundle_items.${i}.variant_ids`] = t(
					"server.package_pick_variant",
				);
				continue;
			}
			if (chosen.some((v) => !comp.variant_ids.includes(v)))
				errors[`bundle_items.${i}.variant_ids`] = t(
					"server.package_variant_foreign",
				);
		}
		return Object.keys(errors).length ? errors : null;
	}

	/**
	 * Refuse an edit that drops a variant a package still points at.
	 * The slot would silently lose an option.
	 * @param id Product being edited.
	 * @param shopId Shop it must belong to.
	 * @param d Validated product input.
	 * @returns Inertia-style errors, or null when nothing would break.
	 */
	async variantErrors(id: number, shopId: number, d: ProductInput) {
		const before = await this.products.find(id, shopId);
		if (!before) return null;
		const keep = new Set(
			d.kind === "bundle" ? [] : d.variants.map((v) => v.id).filter(Boolean),
		);
		for (const v of before.variants) {
			if (keep.has(v.id)) continue;
			const [pkg] = await this.products.usedInBundles(shopId, id, v.id);
			if (pkg)
				return {
					variants: t("server.product_variant_in_package", {
						variant: v.name,
						package: pkg,
					}),
				};
		}
		return null;
	}

	/**
	 * Copy every https image link (product and variants) into our storage.
	 * The links in `d` are swapped for our `/uploads/…` URLs.
	 * So a product never points at another site.
	 * Run it last, after every other check.
	 * So a refused form downloads nothing.
	 * @param shopId The shop the pictures belong to.
	 * @param d Validated product input. Changed in place.
	 * @returns Inertia-style errors naming the link that failed, or null.
	 */
	async copyImages(shopId: number, d: ProductInput) {
		// the same link twice is downloaded once
		const copied = new Map<string, string>();
		const lists = [
			{ key: "images", images: d.images },
			...d.variants.map((v) => ({ key: "variants", images: v.images })),
		];
		for (const list of lists)
			for (const [i, src] of list.images.entries()) {
				if (Storage.isUploadUrl(src)) continue;
				const link = Storage.isHttpsImageUrl(src);
				let url = copied.get(src);
				if (!url) {
					const r = link
						? await Storage.storeImageFromUrl(src, shopId)
						: await Storage.storeImageFromData(src, shopId);
					if ("error" in r)
						return {
							[list.key]: t("server.image_copy_failed", {
								error: r.error,
								// base64 is far too long to show: name its place
								url: link ? src : `#${i + 1}`,
							}),
						};
					url = r.url;
					copied.set(src, url);
				}
				list.images[i] = url;
			}
		return null;
	}

	/**
	 * Create a product (description sanitised first).
	 * @param shopId Owning shop.
	 * @param d Validated product input.
	 * @param userId Credited in the stock ledger for stock typed into the form.
	 * @returns The created product row.
	 */
	async create(shopId: number, d: ProductInput, userId: number) {
		const stockMark = await this.extensions.stockMark(shopId);
		const product = await this.products.create(
			shopId,
			await this.#clean(d),
			userId,
		);
		void this.extensions.emit("product.created", shopId, { product });
		StockRepository.forgetLow(shopId);
		// an opening count typed into the form
		void this.extensions.stockMoved(shopId, stockMark, {
			productId: product.id,
		});
		return product;
	}

	/**
	 * Every check a new product must pass, after its shape is validated.
	 * The form, the API and the extensions all call this.
	 * So no caller skips a rule.
	 * The pictures are copied last, so a refused product downloads nothing.
	 * @param shopId Owning shop.
	 * @param d Validated product input.
	 * Its https image links are swapped for our own in place.
	 * @returns Inertia-style errors, or null when the product may be created.
	 */
	async createErrors(shopId: number, d: ProductInput) {
		return (
			(await this.limitErrors(shopId)) ??
			(await this.categoryErrors(shopId, d)) ??
			(await this.barcodeErrors(shopId, d)) ??
			(await this.bundleErrors(shopId, d)) ??
			(await this.copyImages(shopId, d))
		);
	}

	/**
	 * Every check an edited product must pass, after its shape is validated.
	 * The form and the API both call this.
	 * @param id Product being edited.
	 * @param shopId Owning shop.
	 * @param d Validated product input.
	 * Its https image links are swapped for our own in place.
	 * @returns Inertia-style errors, or null when the product may be saved.
	 */
	async updateErrors(id: number, shopId: number, d: ProductInput) {
		return (
			(await this.categoryErrors(shopId, d)) ??
			(await this.barcodeErrors(shopId, d, id)) ??
			(await this.bundleErrors(shopId, d, id)) ??
			(await this.variantErrors(id, shopId, d)) ??
			(await this.copyImages(shopId, d))
		);
	}

	/**
	 * Create a product from raw input.
	 * It is validated and checked (barcodes, package recipe) like the form.
	 * Then it is created.
	 * This is what an extension's `products.create()` calls.
	 * Nothing skips the rules the form obeys.
	 * @param shopId Owning shop.
	 * @param input The product as sent (the ProductInput shape, money in cents).
	 * @param userId Credited in the stock ledger for an opening count.
	 * @returns The created product row.
	 * @throws An Error naming the first failing field when the input is refused.
	 */
	async createChecked(shopId: number, input: unknown, userId: number) {
		const v = validate(ProductInput, input);
		const errors = v.errors ?? (await this.createErrors(shopId, v.data));
		if (errors || !v.data)
			throw new Error(
				Object.entries(errors ?? {})
					.map(([k, m]) => `${k}: ${m}`)
					.join(", ") || t("server.product_invalid"),
			);
		return this.create(shopId, v.data, userId);
	}

	/**
	 * Overwrite a product (description sanitised first).
	 * @param id Product id.
	 * @param shopId Shop it must belong to.
	 * @param d Validated product input.
	 * @param userId Credited in the stock ledger for stock typed into the form.
	 * @returns The updated product row, or null.
	 */
	async update(id: number, shopId: number, d: ProductInput, userId: number) {
		const before = await this.products.find(id, shopId);
		const saved = await this.#clean(d);
		const product = await this.products.update(id, shopId, saved, userId);
		if (!product) return product;
		void this.extensions.emit("product.updated", shopId, { product });
		if (before) {
			const kept = this.#pictures(saved);
			this.#dropLater([...this.#pictures(before)].filter((u) => !kept.has(u)));
		}
		StockRepository.forgetLow(shopId);
		return product;
	}

	/**
	 * Pin / unpin a product on the list and the storefront.
	 * @param id Product id.
	 * @param shopId Shop it must belong to.
	 * @param featured Whether it should be pinned.
	 */
	async setFeatured(id: number, shopId: number, featured: boolean) {
		await this.products.setFeatured(id, shopId, featured);
		await this.#emitUpdated(id, shopId);
	}

	/**
	 * Add categories to many products at once, keeping the ones they have.
	 * Tells extensions about every product of the shop that was picked.
	 * @param shopId Owning shop.
	 * @param productIds The picked products.
	 * @param categoryIds The categories to add.
	 */
	async addCategories(
		shopId: number,
		productIds: number[],
		categoryIds: number[],
	) {
		const ids = await this.products.addCategories(
			shopId,
			productIds,
			categoryIds,
		);
		for (const id of ids) await this.#emitUpdated(id, shopId);
	}

	/**
	 * Switch a product on or off.
	 * Off hides it from the POS and the online store.
	 * @param id Product id.
	 * @param shopId Shop it must belong to.
	 * @param active Whether it may be sold.
	 */
	async setActive(id: number, shopId: number, active: boolean) {
		await this.products.setActive(id, shopId, active);
		await this.#emitUpdated(id, shopId);
	}

	/**
	 * Delete a product.
	 * Deleting one a package contains would break the recipe.
	 * So that is refused.
	 * @param id Product id.
	 * @param shopId Shop it must belong to.
	 * @returns The message to show, or null once it's gone.
	 */
	async remove(id: number, shopId: number): Promise<string | null> {
		const p = await this.products.find(id, shopId);
		// not in this shop: nothing to delete, and nothing to say about it
		if (!p) return null;
		const [pkg] = await this.products.usedInBundles(shopId, id, null);
		if (pkg)
			return t("server.product_in_package", { name: p.name, package: pkg });
		await this.products.delete(id, shopId);
		void this.extensions.emit("product.deleted", shopId, { product: p });
		this.#dropLater(this.#pictures(p));
		StockRepository.forgetLow(shopId);
		return null;
	}

	/**
	 * Delete pictures nothing uses any more, without making the save wait.
	 * The clean-ups run one after the other, in the order they were asked.
	 * `dropPictures` never throws, so the chain never breaks.
	 * @param urls The pictures the product just stopped using.
	 */
	#dropLater(urls: Iterable<string>) {
		this.#cleanup = this.#cleanup.then(() => this.dropPictures(urls));
	}

	/**
	 * Read a product again and tell the extensions it changed.
	 * Nothing is told when the product is not in the shop.
	 * @param id Product id.
	 * @param shopId Shop it must belong to.
	 */
	async #emitUpdated(id: number, shopId: number) {
		const product = await this.products.find(id, shopId);
		if (product)
			void this.extensions.emit("product.updated", shopId, { product });
	}

	/**
	 * Every uploaded picture of a product.
	 * Its own, its variants', and those inside its description.
	 * @param p A product (or product input) with its variants.
	 * @returns The `/uploads/…` paths, once each.
	 */
	#pictures(p: {
		images: string[];
		description: string;
		variants: { images: string[] }[];
	}): Set<string> {
		const inText = p.description.match(/\/uploads\/[\w./-]+/g) ?? [];
		return new Set(
			[p.images, ...p.variants.map((v) => v.images), inText]
				.flat()
				.filter(Storage.isUploadUrl),
		);
	}

	/**
	 * A product input made safe to save.
	 * The description is rich text rendered with v-html.
	 * It is sanitised here, the one door every write goes through.
	 * A package owns nothing itself: no variants, no stock, no cost.
	 * They all come from its components.
	 * @param d Validated product input.
	 * @returns The input to save.
	 */
	async #clean(d: ProductInput): Promise<ProductInput> {
		return {
			...d,
			description: await sanitizeHtml(d.description),
			...(d.kind === "bundle"
				? { variants: [], track_stock: false, stock: 0, purchase_price: null }
				: { bundle_items: [] }),
		};
	}
}
