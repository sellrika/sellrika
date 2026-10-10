import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { PaymentMethodRepository } from "@repositories/PaymentMethod.Repository";
import { ShopRepository } from "@repositories/Shop.Repository";
import { MailService } from "@services/settings/Mail.Service";
import { slugify } from "@helpers/slug";
import { RESERVED_SLUGS } from "@constants/Store.Constant";
import type { ShopInput } from "@validators/Shop.Validator";

/**
 * Shops.
 * Creating one seeds its payment methods, deleting one is guarded.
 */
@Service()
export class ShopService {
	constructor(
		private shops: ShopRepository,
		private methods: PaymentMethodRepository,
		private mail: MailService,
	) {}

	/**
	 * First free slug for a shop name ("corner-coffee", "corner-coffee-2", …).
	 * @param name The shop name to derive it from.
	 * @param exceptId Shop allowed to keep its current slug.
	 * @returns A slug no other shop uses.
	 */
	async uniqueSlug(name: string, exceptId = 0) {
		// a reserved name ("mail", "pos") gets a number too
		// every slug is a subdomain
		const base = slugify(name) || "shop";
		let slug = base;
		for (
			let i = 2;
			RESERVED_SLUGS.has(slug) || (await this.shops.slugTaken(slug, exceptId));
			i++
		)
			slug = `${base}-${i}`;
		return slug;
	}

	/**
	 * One owner's shops, for the switcher and the settings screen.
	 * @param ownerId The owner.
	 * @returns Their shops, ordered by name.
	 */
	list(ownerId: number) {
		return this.shops.all(ownerId);
	}

	/**
	 * Create a shop and give it the default payment methods.
	 * @param d Validated shop settings.
	 * @param ownerId The user who will own it.
	 * @returns The created shop.
	 */
	async create(d: ShopInput, ownerId: number) {
		const shop = await this.shops.create(
			d,
			await this.uniqueSlug(d.name),
			ownerId,
		);
		await this.methods.seedDefaults(shop.id);
		return shop;
	}

	/**
	 * Edit a shop's general settings.
	 * @param id Shop id.
	 * @param d Validated shop settings.
	 * @returns The updated shop, or null.
	 */
	update(id: number, d: ShopInput) {
		return this.shops.update(id, d);
	}

	/**
	 * Delete one of an owner's shops.
	 * Refuses their last shop, or one that still has products.
	 * @param id Shop id (already known to be the owner's).
	 * @param ownerId The owner.
	 * @returns An error message, or null on success.
	 */
	async remove(id: number, ownerId: number): Promise<string | null> {
		if ((await this.shops.count(ownerId)) <= 1)
			return t("server.shop_keep_one");
		if ((await this.shops.countProducts(id)) > 0)
			return t("server.shop_has_products");
		await this.shops.delete(id);
		// its own mail keys go with it
		await this.mail.forget(id);
		return null;
	}
}
