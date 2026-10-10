/**
 * Mirror of the `Payment` types in `extensions/types.ts`.
 * The app never imports from there, so the shapes are written out again here.
 * Only the online providers are extensions.
 * The manual options — cash on delivery, bank transfer — stay in app/gateways.
 */
import type { ExtensionTranslate } from "@xcore/extensions/ExtensionI18n";
import type { Config, RunningExtension } from "./Extension.Types";

/**
 * One priced line a hosted checkout is asked to charge, in cents.
 */
export type PaymentLine = { name: string; price: number; qty: number };

/**
 * What a hosted checkout charges.
 * The lines, less an optional coupon discount.
 * Plus where the provider sends the buyer back to.
 */
export type CheckoutArgs = {
	lines: PaymentLine[];
	discount?: { label: string; amount: number };
	currency: string;
	successUrl: string;
	cancelUrl: string;
	reference: string;
	email?: string;
};

/**
 * What the app tells a gateway when it looks a payment up.
 */
export type PaymentLookup = {
	/**
	 * False = do not take the money now.
	 * Only for a gateway that takes it during this call (PayPal captures
	 * an approved order here). The discount code of the checkout is no
	 * longer held, so its total no longer stands: answer `failed`.
	 * A gateway whose page already took the money ignores it.
	 */
	capture?: boolean;
};

/**
 * What the shop needs to know about a payment.
 * `failed` means it will never succeed: declined, or expired.
 */
export type PaymentStatus = {
	paid: boolean;
	buyer: { email?: string | null; name?: string | null } | null;
	failed?: boolean;
	reason?: string | null;
};

/**
 * The charge made from a nonce the browser collected.
 * `url` is the page to send the buyer through, null when it is final.
 * `qr` is the code to scan.
 */
export type Charge = { id: string; url: string | null; qr?: string };

/**
 * `mode: "hosted"` — the provider hosts the payment page.
 */
export type HostedPayment = {
	createCheckout: (
		config: Config,
		args: CheckoutArgs,
	) => Promise<{ id: string; url: string }>;
	getPayment: (
		config: Config,
		id: string,
		options?: PaymentLookup,
	) => Promise<PaymentStatus>;
	/**
	 * The provider sent the buyer back without our `?sid=`.
	 * Read its own id from the URL, or from the posted form.
	 */
	returnId?: (url: URL, form: FormData | null) => string | null | undefined;
};

/**
 * `mode: "tokenize"` — the provider's own script takes the card details.
 * It hands back a nonce, which is charged here on the server.
 */
export type TokenizePayment = {
	amount: (cents: number, currency: string) => number;
	methods?: (config: Config) => Promise<string[]>;
	charge: (
		config: Config,
		args: {
			token: string;
			amount: number;
			currency: string;
			returnUri: string;
			reference: string;
			description: string;
		},
	) => Promise<Charge>;
	getPayment: (config: Config, id: string) => Promise<PaymentStatus>;
};

/**
 * One payment extension running for a shop.
 * Its manifest, its settings and its `payment` export.
 */
export type RunningPayment = RunningExtension & {
	payment: HostedPayment | TokenizePayment;
	/**
	 * The gateway's own dictionary in the buyer's language.
	 * A `GatewayError` whose message is a key is shown translated.
	 */
	t: ExtensionTranslate;
};
