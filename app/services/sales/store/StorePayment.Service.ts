import { Service } from "@xcore/di";
import { t } from "@xcore/i18n/I18n";
import type { Shop } from "@models/Shop";
import type { OrderFull } from "@models/Order";
import type { ManualGateway } from "@gateways";
import { GatewayRegistry } from "@gateways/Gateway.Registry";
import { ShopRepository } from "@repositories/Shop.Repository";
import { parseJson } from "@helpers/json";
import { openFields } from "@helpers/secretFields";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import type { RunningPayment } from "@services/settings/extensions/types/Extension.Payments.Types";
import type { RunningExtension } from "@services/settings/extensions/types/Extension.Types";

type Errors = Record<string, string>;

/**
 * The stored fields of every manual payment option, by option key.
 */
export type StoredCreds = Record<string, Record<string, string>>;

/**
 * One way a buyer can pay, as the checkout page lists it.
 */
export type PaymentOption = {
	key: string;
	label: string;
	manual: boolean;
	instructions: string;
};

/**
 * How a shop's online store takes money.
 * The one gateway extension switched on,
 * and the manual options (cash on delivery, bank transfer).
 */
@Service()
export class StorePaymentService {
	constructor(
		private shops: ShopRepository,
		private gateways: GatewayRegistry,
		private extensions: ExtensionService,
	) {}

	/**
	 * How a buyer can pay in this store, for the checkout page.
	 * The gateway extension comes first (when one is on).
	 * Then every manual option switched on, with what the buyer is told
	 * (bank details). Never a secret.
	 * @param shop The selling shop.
	 * @param running The shop's running extensions, when already loaded.
	 * @returns The options in the order the page lists them
	 *   ([] = the store can't take orders).
	 */
	async paymentOptions(
		shop: Shop,
		running?: RunningExtension[],
	): Promise<PaymentOption[]> {
		const online = await this.extensions.onlinePayment(shop.id, running);
		const out: PaymentOption[] = online
			? [
					{
						key: online.ext.key,
						label: t("store_server.online_payment_label"),
						manual: false,
						instructions: "",
					},
				]
			: [];
		const raw = shop.manual_gateways.length
			? await this.shops.credentials(shop.id)
			: null;
		for (const key of shop.manual_gateways) {
			const gw = this.gateways.get(key);
			// switched on before the option was removed from the registry
			if (!gw) continue;
			out.push({
				key: gw.key,
				label: gw.label,
				manual: true,
				instructions: this.#instructionsOf(gw, raw),
			});
		}
		return out;
	}

	/**
	 * Who takes the money, for the storefront's "Secure payment by …" line.
	 * @param shop The selling shop.
	 * @param running The shop's running extensions, when already loaded.
	 * @returns The gateway extension's name, else the first manual
	 *   option's label, else "card".
	 */
	async paymentLabel(
		shop: Shop,
		running?: RunningExtension[],
	): Promise<string> {
		const online = await this.extensions.onlinePayment(shop.id, running);
		return (
			(online && this.extensions.localized(online.ext).name) ??
			this.gateways.get(shop.manual_gateways[0] ?? "")?.label ??
			t("store_server.card")
		);
	}

	/**
	 * What the buyer of an unpaid order was told about paying.
	 * These are the bank details behind the manual option the order was
	 * placed with, matched by the label stored on the order.
	 * @param shop The selling shop.
	 * @param order The order.
	 * @returns The instructions, or null (paid order, cash on delivery,
	 *   option gone).
	 */
	async paymentInstructions(shop: Shop, order: OrderFull) {
		if (order.payment_status === "paid") return null;
		return (
			(await this.paymentOptions(shop)).find(
				(o) => o.manual && o.label === order.payment_method,
			)?.instructions || null
		);
	}

	/**
	 * A manual payment option (cash on delivery, bank transfer) the shop
	 * has switched on.
	 * @param shop The selling shop.
	 * @param key The option the buyer picked.
	 * @returns The gateway, or null when it isn't on for this shop.
	 */
	manualOf(shop: Shop, key: string): ManualGateway | null {
		const gw = this.gateways.get(key);
		return gw && shop.manual_gateways.includes(key) ? gw : null;
	}

	/**
	 * The shop's online payment gateway, ready to use.
	 * It is the one gateway extension switched on.
	 * @param shop The selling shop.
	 * @returns The running extension with its settings and its `payment`
	 *   export, or `{errors}` when no gateway takes money right now
	 *   (none switched on, settings missing, or an APP_KEY that can't
	 *   read them).
	 */
	async gatewayOf(shop: Shop): Promise<RunningPayment | { errors: Errors }> {
		return (
			(await this.extensions.onlinePayment(shop.id)) ?? {
				errors: StorePaymentService.paymentsOff(),
			}
		);
	}

	/**
	 * Read a shop's stored payment fields.
	 * @param raw The shop's raw `payment_credentials` JSON, or null.
	 * @returns The fields by option key ({} when nothing is stored).
	 */
	static storedCreds(raw: string | null): StoredCreds {
		return parseJson<StoredCreds>(raw, {});
	}

	/**
	 * The error shown when no gateway can take money.
	 * The shop has no payment gateway switched on,
	 * or its credentials are incomplete.
	 * @returns `{cart}` with the message.
	 */
	static paymentsOff() {
		return { cart: t("store_server.payments_off") };
	}

	/**
	 * Is this a failure the buyer may be shown?
	 * A gateway extension throws an `Error` named "GatewayError".
	 * It can't import our code, so the name is the mark.
	 * @param e What was thrown.
	 * @returns True for a `GatewayError`.
	 */
	static buyerError(e: unknown) {
		return e instanceof Error && e.name === "GatewayError";
	}

	/**
	 * What a manual option tells the buyer (the bank details).
	 * An `APP_KEY` that no longer decrypts shows nothing.
	 * Manual fields aren't secret, so that can't really happen.
	 * @param gw The manual option.
	 * @param raw The shop's raw payment_credentials JSON.
	 * @returns The text, or "" when there is none.
	 */
	#instructionsOf(gw: ManualGateway, raw: string | null) {
		try {
			return (
				(gw.instructions && this.#credsFor(gw, raw)?.[gw.instructions]) || ""
			);
		} catch {
			return "";
		}
	}

	/**
	 * Decrypted field map for a manual payment option.
	 * @param gw The option's definition.
	 * @param raw The shop's raw payment_credentials JSON.
	 * @returns The decrypted field map, or null while any field is missing.
	 * @throws When APP_KEY no longer decrypts the stored secrets.
	 */
	#credsFor(
		gw: ManualGateway,
		raw: string | null,
	): Record<string, string> | null {
		return openFields(
			gw.fields,
			StorePaymentService.storedCreds(raw)[gw.key] ?? {},
		);
	}
}
