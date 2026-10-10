import { Service } from "@xcore/di";
import type { Shop } from "@models/Shop";
import type { OrderFull } from "@models/Order";
import type {
	StoreCouponInput,
	StoreSendInput,
	StoreDeliveryInput,
	StoreLanguagesInput,
	StoreThemeInput,
	StoreCurrenciesInput,
	StorePageInput,
} from "@validators/Store.Validator";
import { STORE_RELATED } from "@constants/Store.Constant";
import type { RunningExtension } from "@services/settings/extensions/types/Extension.Types";
import {
	type BrowseFilters,
	StoreCatalogService,
	type StoreProduct,
} from "./store/StoreCatalog.Service";
import {
	type CheckoutArgs,
	type CheckoutResult,
	type CouponQuote,
	StoreCheckoutService,
	type Tokenize,
} from "./store/StoreCheckout.Service";
import { StoreFulfillService } from "./store/StoreFulfill.Service";
import { StorePaymentService } from "./store/StorePayment.Service";
import {
	type StoreSettingsArgs,
	StoreSettingsService,
} from "./store/StoreSettings.Service";

export type { CouponQuote, StoreProduct, Tokenize };

/**
 * The public storefront and its checkout.
 * One front door for the catalogue, the settings, the custom pages
 * and the payment flow.
 * The work is done by the services in `./store/`. This class only
 * hands each call to the one that owns it.
 */
@Service()
export class StoreService {
	constructor(
		private catalogs: StoreCatalogService,
		private storeSettings: StoreSettingsService,
		private payments: StorePaymentService,
		private checkouts: StoreCheckoutService,
		private fulfills: StoreFulfillService,
	) {}

	/**
	 * Public product list for the storefront.
	 * @param shopId Owning shop.
	 * @returns Every product on sale as the storefront sees it.
	 */
	catalog(shopId: number) {
		return this.catalogs.catalog(shopId);
	}

	/**
	 * One page of the public catalog, plus the per-category counts.
	 * @param shopId Owning shop.
	 * @param f Search text, category, page, order, `stock` and `featured`.
	 * @returns The page of products, the counts and the featured products.
	 */
	browse(shopId: number, f: BrowseFilters) {
		return this.catalogs.browse(shopId, f);
	}

	/**
	 * The "Related products" a product page shows.
	 * @param all The shop's public catalog.
	 * @param product The product on the page.
	 * @param limit How many to return.
	 * @returns Up to `limit` other products, best match first.
	 */
	related(all: StoreProduct[], product: StoreProduct, limit = STORE_RELATED) {
		return this.catalogs.related(all, product, limit);
	}

	/**
	 * Settings for the admin page.
	 * @param shopId Owning shop.
	 * @returns Storefront settings, the manual options switched on, their
	 *   fields and a `secret_set` map.
	 */
	settings(shopId: number) {
		return this.storeSettings.settings(shopId);
	}

	/**
	 * Save the Delivery section of /online-store.
	 * @param shopId Owning shop.
	 * @param d Validated delivery settings.
	 * @returns When it is saved.
	 */
	updateDelivery(shopId: number, d: StoreDeliveryInput) {
		return this.storeSettings.updateDelivery(shopId, d);
	}

	/**
	 * Save the Languages section of /online-store.
	 * @param shopId Owning shop.
	 * @param d Validated locales, the default first.
	 * @returns When it is saved.
	 */
	updateLanguages(shopId: number, d: StoreLanguagesInput) {
		return this.storeSettings.updateLanguages(shopId, d);
	}

	/**
	 * Save the shop's own colours and font for one built-in theme.
	 * @param shopId Owning shop.
	 * @param d The theme and its checked look.
	 * @returns When it is saved.
	 */
	updateTheme(shopId: number, d: StoreThemeInput) {
		return this.storeSettings.updateTheme(shopId, d);
	}

	/**
	 * Save the Currencies section of /online-store.
	 * @param shop The shop.
	 * @param d Validated currencies, each with its manual rate or null.
	 * @returns When it is saved.
	 */
	updateCurrencies(shop: Shop, d: StoreCurrenciesInput) {
		return this.storeSettings.updateCurrencies(shop, d);
	}

	/**
	 * Save the online-store settings.
	 * @param shopId Owning shop.
	 * @param d The validated online-store form.
	 * @returns `{errors}` when something is wrong, `{}` when saved.
	 */
	updateSettings(shopId: number, d: StoreSettingsArgs) {
		return this.storeSettings.updateSettings(shopId, d);
	}

	/**
	 * How a buyer can pay in this store, for the checkout page.
	 * @param shop The selling shop.
	 * @param running The shop's running extensions, when already loaded.
	 * @returns The options in the order the page lists them
	 *   ([] = the store can't take orders).
	 */
	paymentOptions(shop: Shop, running?: RunningExtension[]) {
		return this.payments.paymentOptions(shop, running);
	}

	/**
	 * Who takes the money, for the "Secure payment by …" line.
	 * @param shop The selling shop.
	 * @param running The shop's running extensions, when already loaded.
	 * @returns The gateway extension's name, else the first manual
	 *   option's label, else "card".
	 */
	paymentLabel(shop: Shop, running?: RunningExtension[]) {
		return this.payments.paymentLabel(shop, running);
	}

	/**
	 * What the buyer of an unpaid order was told about paying.
	 * @param shop The selling shop.
	 * @param order The order.
	 * @returns The instructions, or null.
	 */
	paymentInstructions(shop: Shop, order: OrderFull) {
		return this.payments.paymentInstructions(shop, order);
	}

	/**
	 * "Track my order": the order by its public code.
	 * @param shop The shop whose store the lookup runs on.
	 * @param code The public order code (normalised).
	 * @param contact The email or phone they ordered with.
	 * @returns The order with its lines, or null.
	 */
	track(shop: Shop, code: string, contact: string) {
		return this.fulfills.track(shop, code, contact);
	}

	/**
	 * Create or update a custom store page.
	 * @param shopId Owning shop.
	 * @param id Page to overwrite, or null to create one.
	 * @param d Validated title, slug, body and CSS.
	 * @returns `{errors}` when the slug clashes or the page is gone,
	 *   `{}` when saved.
	 */
	savePage(shopId: number, id: number | null, d: StorePageInput) {
		return this.storeSettings.savePage(shopId, id, d);
	}

	/**
	 * Start an online checkout.
	 * @param shop The selling shop.
	 * @param input Validated cart lines, the buyer's details, pickup,
	 *   payment option and discount code.
	 * @param storeUrl Absolute URL of this storefront.
	 * @param customerId The signed-in customer, or null for a guest.
	 * @returns `{url}` to send the customer to, `{tokenize}` to open the
	 *   provider's form, or `{errors}`.
	 */
	checkout(
		shop: Shop,
		input: CheckoutArgs,
		storeUrl: string,
		customerId: number | null = null,
	): Promise<CheckoutResult> {
		return this.checkouts.checkout(shop, input, storeUrl, customerId);
	}

	/**
	 * "Send order" in the cart of a store with no payment option.
	 * @param shop The selling shop.
	 * @param input Validated cart lines.
	 * @param storeUrl Absolute URL of this storefront.
	 * @param customerId The signed-in customer, or null for a guest.
	 * @returns `{url}` of the thank-you page, or `{errors}`.
	 */
	send(
		shop: Shop,
		input: StoreSendInput,
		storeUrl: string,
		customerId: number | null = null,
	): Promise<CheckoutResult> {
		return this.checkouts.send(shop, input, storeUrl, customerId);
	}

	/**
	 * The guided address for the checkout page.
	 * @param country Country name as the checkout stores it ("" = unknown).
	 * @param state The chosen state ("" = just the states).
	 * @param q What the buyer typed in the City box.
	 * @returns The states, the cities and `more`.
	 */
	address(country: string, state: string, q = "") {
		return this.checkouts.address(country, state, q);
	}

	/**
	 * "Apply" on the checkout page: what a discount code takes off.
	 * @param shop The selling shop.
	 * @param input The cart, the code, and what's typed so far.
	 * @param customerId The signed-in store customer, or null for a guest.
	 * @returns `{quote}`, or `{errors}` for the code box.
	 */
	quote(shop: Shop, input: StoreCouponInput, customerId: number | null = null) {
		return this.checkouts.quote(shop, input, customerId);
	}

	/**
	 * Charge the nonce the gateway's browser form produced.
	 * @param shop The selling shop.
	 * @param ref The cart's own session key.
	 * @param token The nonce the provider's form produced.
	 * @param storeUrl Absolute URL of this storefront.
	 * @returns `{url}` to send the buyer to (with `qr` for a QR method),
	 *   or `{errors}`.
	 */
	pay(shop: Shop, ref: string, token: string, storeUrl: string) {
		return this.checkouts.pay(shop, ref, token, storeUrl);
	}

	/**
	 * The customer came back from the gateway: make the order, once.
	 * @param shop The selling shop.
	 * @param sessionId The `sid` the customer came back with.
	 * @returns `{order}`, `{pending}`, `{failed, reason}` or `{error}`.
	 */
	fulfill(shop: Shop, sessionId: string) {
		return this.fulfills.fulfill(shop, sessionId);
	}

	/**
	 * The hidden, deactivated user that online orders are signed by.
	 * @returns That user.
	 */
	systemUser() {
		return this.fulfills.systemUser();
	}
}
