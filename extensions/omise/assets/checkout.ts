/**
 * Omise has no hosted page, so its own pre-built form opens here.
 * The form keeps its defaults, its chrome and its close button.
 * It offers every payment method the merchant's account
 * has switched on.
 * The nonce it makes goes back to the POS, which charges it on the
 * server and moves the buyer on.
 * The payment itself never touches our code.
 */
import type { PaymentScript } from "../../types";

/**
 * Omise's browser SDK, which brings OmiseCard with it.
 */
const SDK = "https://cdn.omise.co/omise.js";

/**
 * The part of Omise's OmiseCard global we use.
 */
type OmiseCard = {
	configure: (options: Record<string, unknown>) => void;
	open: (options: Record<string, unknown>) => void;
};

/**
 * The scripts already being loaded, by URL.
 * It keeps one promise per script, so nothing is added twice.
 */
const loading = new Map<string, Promise<void>>();
/**
 * Add a script tag once and wait for it.
 * A second call for the same URL gets the same promise.
 * @param src The script URL.
 * @returns Resolves when it is loaded, rejects when it fails.
 */
const loadScript = (src: string) => {
	let p = loading.get(src);
	if (!p) {
		p = new Promise<void>((ok, fail) => {
			const el = document.createElement("script");
			el.src = src;
			el.onload = () => ok();
			el.onerror = () => {
				loading.delete(src);
				fail(new Error(`Could not load ${src}`));
			};
			document.head.appendChild(el);
		});
		loading.set(src, p);
	}
	return p;
};

/**
 * Open OmiseCard over the checkout page.
 * @param t The public key, the amount in Omise's unit,
 *   our session reference and the other methods switched on.
 * @param api What the page gives back to the POS.
 *   `pay(nonce)` charges the nonce and moves the buyer on.
 *   `cancel()` runs when the form is closed.
 *   `fail(msg)` runs when the form cannot open.
 *   `t(key)` reads i18n/<locale>.ts in the buyer's language.
 */
const script: PaymentScript = async (t, api) => {
	try {
		await loadScript(SDK);
	} catch {
		return api.fail(api.t("error.form_load"));
	}
	const OmiseCard = (window as unknown as { OmiseCard?: OmiseCard }).OmiseCard;
	if (!OmiseCard) return api.fail(api.t("error.form_missing"));
	OmiseCard.configure({
		publicKey: t.public_key,
		/**
		 * Left out entirely when there is nothing to offer.
		 * An empty list would blank out the form's method tabs.
		 */
		...(t.methods.length ? { otherPaymentMethods: t.methods } : {}),
		/**
		 * The buyer backed out.
		 * Let them try again.
		 */
		onFormClosed: () => api.cancel(),
		onCreateTokenSuccess: (nonce: string) => api.pay(nonce),
	});
	OmiseCard.open({
		amount: t.amount,
		currency: t.currency,
		frameLabel: api.store.name,
		submitLabel: api.t("form.pay"),
	});
};

export default script;
