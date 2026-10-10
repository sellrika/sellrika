import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { PaymentMethodRepository } from "@repositories/PaymentMethod.Repository";
import { UploadCleaner } from "@services/Upload.Service";
import type { PaymentMethodInput } from "@validators/PaymentMethod.Validator";

/**
 * Payment methods, per shop.
 * A shop must always keep at least one.
 */
@Service()
export class PaymentMethodService {
	constructor(
		private methods: PaymentMethodRepository,
		private cleaner: UploadCleaner,
	) {}

	/**
	 * Every method of a shop, for the settings screen.
	 * @param shopId Owning shop.
	 * @returns Methods in display order, enabled and disabled alike.
	 */
	list(shopId: number) {
		return this.methods.allForShop(shopId);
	}

	/**
	 * What the POS may actually offer at checkout.
	 * @param shopId Owning shop.
	 * @returns Only the enabled methods.
	 */
	async listEnabled(shopId: number) {
		return (await this.methods.allForShop(shopId)).filter((m) => m.enabled);
	}

	/**
	 * Add a method.
	 * @param shopId Owning shop.
	 * @param d Validated name, icon, colour, picture and flags.
	 * @returns The created method.
	 */
	create(shopId: number, d: PaymentMethodInput) {
		return this.methods.create(shopId, d);
	}

	/**
	 * Edit a method.
	 * @param id Method id.
	 * @param shopId Shop it must belong to.
	 * @param d Validated name, icon, colour, picture and flags.
	 * @returns The updated method, or null.
	 */
	async update(id: number, shopId: number, d: PaymentMethodInput) {
		const before = await this.methods.find(id, shopId);
		const method = await this.methods.update(id, shopId, d);
		// a replaced or removed picture leaves storage too
		if (method && before?.image !== method.image)
			await this.#dropImage(before?.image ?? null);
		return method;
	}

	/**
	 * Delete a method.
	 * A shop must keep at least one (checkout needs one).
	 * @param id Method id.
	 * @param shopId Shop it must belong to.
	 * @returns An error message, or null on success.
	 */
	async remove(id: number, shopId: number): Promise<string | null> {
		if ((await this.methods.count(shopId)) <= 1)
			return t("server.payment_method_keep_one");
		const before = await this.methods.find(id, shopId);
		await this.methods.delete(id, shopId);
		await this.#dropImage(before?.image ?? null);
		return null;
	}

	/**
	 * Delete a method's picture once nothing uses it any more.
	 * Run it after the database change is saved.
	 * Never throws: a failure is logged and the save stays done.
	 * @param url The picture the method just stopped using, or null.
	 */
	async #dropImage(url: string | null) {
		if (!url) return;
		await this.cleaner.dropUnused([url], "payment methods");
	}
}
