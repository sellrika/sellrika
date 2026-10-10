import { Container } from "@xcore/di";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import { zip } from "@helpers/zip";

/**
 * Fake payment gateway extensions for the store tests: a real zip, uploaded and switched on the way an
 * admin does it. Both fakes read what they should do from `globalThis.__pay` and write down what they were
 * given, so a test can flip paid / failed and then read the arguments the gateway saw.
 */
export type FakePay = {
	id?: string; // the hosted checkout id (the sid the cart is keyed by)
	url?: string; // where the hosted checkout sends the buyer
	fail?: string; // a buyer-facing failure ("Your card was declined") instead of a checkout / charge
	status?: {
		paid: boolean;
		buyer: unknown;
		failed?: boolean;
		reason?: string | null;
	}; // what getPayment answers
	methods?: string[]; // the tokenize form's other methods
	methodsFail?: boolean; // the methods lookup blows up — the form must still open
	throws?: string; // the provider can't be reached at all (not a buyer-facing failure)
	chargeId?: string;
	chargeUrl?: string | null; // the 3-D Secure page, null = the charge is final
	qr?: string;
	checkout?: { config: Record<string, unknown>; args: Record<string, unknown> }; // what createCheckout saw
	charged?: { config: Record<string, unknown>; args: Record<string, unknown> }; // what charge saw
	looked?: { config: Record<string, unknown>; id: string }; // what getPayment saw
};

/** Read / set what the fakes do next. */
export const pay = () => ((globalThis as any).__pay ??= {}) as FakePay;
/** Forget everything the fakes did and were told. */
export const resetPay = () => ((globalThis as any).__pay = {} as FakePay);

const THROW = `if (p.fail) { const e = new Error(p.fail); e.name = "GatewayError"; throw e; }`;

/** `mode: "hosted"` — the buyer pays on the provider's page and comes back to /done. */
export const HOSTED_MODULE = `const pay = () => (globalThis.__pay ??= {});
export const payment = {
  async createCheckout(config, args) { const p = pay(); p.checkout = { config, args }; ${THROW} return { id: p.id ?? "fk_1", url: p.url ?? "https://gw.test/pay" }; },
  async getPayment(config, id) { const p = pay(); p.looked = { config, id }; if (p.throws) { throw new Error(p.throws); } return p.status ?? { paid: false, buyer: null }; },
  returnId: (url, form) => url.searchParams.get("token") || form?.get("ref") || null,
};`;

/**
 * `mode: "tokenize"`.
 * The provider's own form runs in the browser.
 * The nonce is charged here.
 */
export const TOKENIZE_MODULE = `const pay = () => (globalThis.__pay ??= {});
export const payment = {
  amount: (cents, currency) => (currency.toUpperCase() === "JPY" ? Math.round(cents / 100) : cents),
  async methods(config) { const p = pay(); if (p.methodsFail) { throw new Error("capability is down"); } return p.methods ?? []; },
  async charge(config, args) { const p = pay(); p.charged = { config, args }; ${THROW} return { id: p.chargeId ?? "chrg_1", url: p.chargeUrl ?? null, ...(p.qr ? { qr: p.qr } : {}) }; },
  async getPayment(config, id) { const p = pay(); p.looked = { config, id }; if (p.throws) { throw new Error(p.throws); } return p.status ?? { paid: false, buyer: null }; },
};`;

/** The hosted fake's manifest: one secret key to fill in. */
export const hostedManifest = (over: Record<string, unknown> = {}) => ({
	key: "fake-hosted",
	name: "Fake Hosted",
	version: "1.0.0",
	main: "index.js",
	fields: [
		{ name: "secret_key", label: "Secret key", secret: true, required: true },
	],
	payment: { mode: "hosted" },
	...over,
});

/**
 * The tokenize fake's manifest.
 * A public key the browser may see, a secret one it may not,
 * and a checkout script.
 */
export const tokenizeManifest = (over: Record<string, unknown> = {}) => ({
	key: "fake-tokenize",
	name: "Fake Tokenize",
	version: "1.0.0",
	main: "index.js",
	fields: [
		{ name: "public_key", label: "Public key", required: true },
		{ name: "secret_key", label: "Secret key", secret: true, required: true },
	],
	payment: {
		mode: "tokenize",
		public_field: "public_key",
		script: "assets/checkout.js",
	},
	...over,
});

/**
 * Put one extension zip to work for a shop, the way it happens in the app.
 * The platform admin uploads it and switches it on for all shops.
 * The shop then has it installed, still off (a gateway needs its keys first).
 * @param shopId The shop.
 * @param manifest The extension.json contents.
 * @param module The entry module's source.
 * @param extra More files for the zip (a tokenize gateway's checkout script).
 * @returns What `ExtensionService.upload` answered (`{key}` or `{errors}`).
 */
export async function installPayment(
	shopId: number,
	manifest: Record<string, unknown>,
	module: string,
	extra: Record<string, string> = {},
) {
	const files = {
		"extension.json": JSON.stringify(manifest),
		[String(manifest.main ?? "index.js")]: module,
		...extra,
	};
	const extensions = Container.get(ExtensionService);
	const answer = await extensions.upload(
		new File([zip(files).slice().buffer as ArrayBuffer], "gw.zip"),
	);
	if (answer.key) {
		await extensions.setGlobal(answer.key, true);
		await extensions.save(shopId, answer.key, { enabled: false });
	}
	return answer;
}

/**
 * Install (once) and switch on a fake gateway with its settings — the checkout then runs through it.
 * @param shopId The shop.
 * @param kind Which fake.
 * @param config Its settings (defaults are filled in).
 * @returns What `ExtensionService.save` answered.
 */
export async function useGateway(
	shopId: number,
	kind: "hosted" | "tokenize" = "hosted",
	config: Record<string, string> = {},
) {
	const ext = Container.get(ExtensionService);
	const hosted = kind === "hosted";
	const manifest = hosted ? hostedManifest() : tokenizeManifest();
	if (!(await ext.list(shopId)).some((e) => e.key === manifest.key)) {
		await installPayment(
			shopId,
			manifest,
			hosted ? HOSTED_MODULE : TOKENIZE_MODULE,
			hosted ? {} : { "assets/checkout.js": "export default () => {};" },
		);
	}
	const defaults: Record<string, string> = hosted
		? { secret_key: "sk_fake" }
		: { public_key: "pk_fake", secret_key: "sk_fake" };
	return ext.save(shopId, manifest.key, {
		enabled: true,
		config: { ...defaults, ...config },
	});
}
