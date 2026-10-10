import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { Auth } from "@xcore/auth/Auth";
import { Paginate } from "@xcore/http/Paginate";
import { HttpRequest, Query } from "@xcore/http/Request";
import { HttpResponse, json } from "@xcore/http/Response";
import { t } from "@xcore/i18n/I18n";
import { redirect } from "@xcore/view/Inertia";
import { normalizeReference } from "@helpers/crypto";
import { StoreService } from "@services/sales/Store.Service";
import { StoreAuthService } from "@services/sales/StoreAuth.Service";
import {
	StoreAddressInput,
	StoreLoginInput,
	StoreProfileInput,
} from "@validators/Store.Validator";
import {
	StoreViewService,
	type Storefront,
} from "@services/sales/StoreView.Service";
import { validate, type Errors } from "@validators/validate";
import { StorefrontSupport } from "@controllers/support/Storefront.Support";

/**
 * A form of the account page that failed:
 * the errors, what was posted, and the tab it is on.
 */
type FailedForm = {
	errors: Errors;
	old: Record<string, unknown>;
	tab: string;
};

/**
 * Customer accounts on the public store.
 * The customer signs in through the shop's Firebase project.
 * The rules are in `StoreAuthService`.
 */
@Service()
export class StoreAccountController {
	constructor(
		private site: StorefrontSupport,
		private auth: StoreAuthService,
		private store: StoreService,
		private view: StoreViewService,
	) {}

	/**
	 * GET /account?page= — the customer's account.
	 * It has the name and phone, the delivery addresses and past orders.
	 * A guest sees "sign in".
	 * @param req The current request.
	 * @returns The theme's account page (noindex), or the not-found page.
	 */
	async accountPage(req: BunRequest<"/account">) {
		const s = await this.site.open(req);
		if (s instanceof Response) return s;
		return this.#renderAccount(req, s);
	}

	/**
	 * GET /account/orders/:reference — one of the signed-in customer's
	 * orders, with its status and lines.
	 * @param req The current request.
	 * @returns The theme's order page (noindex), the account page for
	 *   a guest, or the not-found page.
	 */
	async accountOrder(req: BunRequest<"/account/orders/:reference">) {
		const s = await this.site.openCustomer(req);
		if (s instanceof Response) return s;
		const code = normalizeReference(req.params.reference);
		const order = code ? await this.auth.order(s.customer, code) : null;
		if (!order) return this.view.notFound(req, s);
		return this.view.render(
			s,
			"order",
			{
				order: {
					...StoreViewService.pubOrder(order),
					instructions: await this.store.paymentInstructions(s.shop, order),
				},
			},
			StoreViewService.storeSeo(s.shop, {
				url: `${s.url}/account/orders/${order.reference}`,
				title: t("store_server.seo_order_title", {
					code: order.reference ?? "",
					name: s.shop.name,
				}),
				desc: t("store_server.seo_order_desc", { name: s.shop.name }),
				noindex: true,
			}),
		);
	}

	/**
	 * JSON: POST /account/login — the browser signed in with Firebase
	 * and sends the ID token.
	 * The token is verified here, then the customer session cookie is set.
	 * `unverified` = the page should offer to resend the verification link.
	 * @param req The current request.
	 * @returns `{ customer }` (200), or 422 `{ errors, unverified? }`.
	 */
	async login(req: BunRequest<"/account/login">) {
		const s = await this.site.openJson(req, "token");
		if (s instanceof Response) return s;
		const v = validate(StoreLoginInput, await HttpRequest.body(req));
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		const r = await this.auth.login(s.shop, v.data.token);
		if (r.errors)
			return json({ errors: r.errors, unverified: !!r.unverified }, 422);
		await Auth.customerLogin(req, r.customer.id, s.shop.id);
		return json({
			customer: StoreViewService.pubCustomer(
				r.customer,
				await this.auth.addresses(r.customer),
			),
		});
	}

	/**
	 * POST /account/logout — sign the customer out of this browser.
	 * @param req The current request.
	 * @returns 303 to the store.
	 */
	async logout(req: BunRequest<"/account/logout">) {
		const s = await this.site.open(req);
		if (s instanceof Response) return s;
		await Auth.customerLogout(req);
		return redirect(s.base || "/");
	}

	/**
	 * POST /account — the signed-in customer changes their name / phone.
	 * A plain HTML form post.
	 * @param req The current request.
	 * @returns 303 to the Details tab, or the page with errors.
	 *   A guest gets a 303 to the account page.
	 */
	async updateProfile(req: BunRequest<"/account">) {
		const s = await this.site.openCustomer(req);
		if (s instanceof Response) return s;
		const raw = await HttpRequest.body(req);
		const v = validate(StoreProfileInput, raw);
		const errors =
			v.errors ?? (await this.auth.updateProfile(s.customer, v.data!)).errors;
		return errors
			? this.#renderAccount(req, s, {
					errors,
					old: this.#fieldsOf(raw),
					tab: "details",
				})
			: redirect(`${s.base}/account?tab=details&saved=1`);
	}

	/**
	 * POST /account/addresses — the signed-in customer adds
	 * a delivery address.
	 * @param req The current request.
	 * @returns 303 to the Addresses tab, or the page with errors.
	 *   A guest gets a 303 to the account page.
	 */
	async addAddress(req: BunRequest<"/account/addresses">) {
		const s = await this.site.openCustomer(req);
		if (s instanceof Response) return s;
		const raw = await HttpRequest.body(req);
		const v = validate(StoreAddressInput, raw);
		const errors =
			v.errors ?? (await this.auth.addAddress(s.customer, v.data!)).errors;
		return errors
			? this.#renderAccount(req, s, {
					errors,
					old: this.#fieldsOf(raw),
					tab: "address",
				})
			: redirect(`${s.base}/account?tab=address`);
	}

	/**
	 * POST /account/addresses/:id — the signed-in customer changes
	 * one saved address.
	 * @param req The current request.
	 * @returns 303 to the Addresses tab, the page with errors
	 *   (`old.id` = the address), or not found for an address that
	 *   isn't theirs. A guest gets a 303 to the account page.
	 */
	async updateAddress(req: BunRequest<"/account/addresses/:id">) {
		const s = await this.site.openCustomer(req);
		if (s instanceof Response) return s;
		const id = HttpRequest.idOf(req);
		const raw = await HttpRequest.body(req);
		const v = validate(StoreAddressInput, raw);
		if (v.errors)
			return this.#renderAccount(req, s, {
				errors: v.errors,
				old: { ...this.#fieldsOf(raw), id },
				tab: "address",
			});
		const saved = await this.auth.updateAddress(s.customer, id, v.data);
		return saved
			? redirect(`${s.base}/account?tab=address`)
			: this.view.notFound(req, s);
	}

	/**
	 * POST /account/addresses/:id/delete — the signed-in customer
	 * removes one saved address.
	 * @param req The current request.
	 * @returns 303 to the Addresses tab (to the page for a guest).
	 */
	async removeAddress(req: BunRequest<"/account/addresses/:id/delete">) {
		const s = await this.site.openCustomer(req);
		if (s instanceof Response) return s;
		await this.auth.removeAddress(s.customer, HttpRequest.idOf(req));
		return redirect(`${s.base}/account?tab=address`);
	}

	/**
	 * A posted form, as the account page prints it back after an error.
	 * @param raw The request body.
	 * @returns Its fields, or {} when it is not an object.
	 */
	#fieldsOf(raw: unknown): Record<string, unknown> {
		return raw && typeof raw === "object"
			? (raw as Record<string, unknown>)
			: {};
	}

	/**
	 * The account page.
	 * A signed-in customer sees their orders, details and addresses.
	 * A guest sees the sign-in prompt.
	 * @param req The current request.
	 * @param s The resolved storefront.
	 * @param failed After a failed form post: the errors, what was
	 *   posted, and the tab.
	 * @returns The account page (noindex), 422 when a form failed.
	 */
	async #renderAccount(
		req: Request,
		s: Storefront,
		failed: FailedForm | null = null,
	) {
		const q = new Query(req);
		const orders = s.customer
			? await this.auth.orders(s.customer, Paginate.number(q.raw("page")))
			: null;
		return this.view.render(
			s,
			"account",
			{
				orders: orders && {
					...orders,
					data: orders.data.map(StoreViewService.pubOrder),
				},
				states: await this.site.states(s),
				errors: failed?.errors ?? {},
				old: failed?.old ?? {},
				tab: failed?.tab ?? (q.raw("tab") || "orders"),
				// just back from saving the details form: the page says "Saved"
				saved: !failed && q.raw("saved") === "1",
			},
			this.site.privateSeo(
				s,
				"/account",
				t("store_server.seo_account_title", { name: s.shop.name }),
				t("store_server.seo_account_desc", { name: s.shop.name }),
			),
			failed ? 422 : 200,
		);
	}
}
