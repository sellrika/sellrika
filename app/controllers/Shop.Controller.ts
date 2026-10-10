import { Account } from "@xcore/auth/Account";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { HttpResponse } from "@xcore/http/Response";
import { Url } from "@xcore/http/Url";
import { t } from "@xcore/i18n/I18n";
import { back, Inertia, inertia, redirect } from "@xcore/view/Inertia";
import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { SessionRepository } from "@repositories/Session.Repository";
import { ShopRepository } from "@repositories/Shop.Repository";
import { ShopService } from "@services/settings/Shop.Service";
import { InviteService } from "@services/settings/Invite.Service";
import { PlanLimitService } from "@services/settings/PlanLimit.Service";
import { ShopOwnerInput } from "@validators/User.Validator";
import { ShopInput } from "@validators/Shop.Validator";
import { TIMEZONES } from "@constants/Shop.Constant";
import { validate, type Errors } from "@validators/validate";
import type { Shop } from "@models/Shop";

/**
 * Admin-only shop management, plus the shop switcher every signed-in user
 * may use.
 * Everyone only ever sees and touches the shops of their own account.
 */
@Service()
export class ShopController {
	constructor(
		private shops: ShopService,
		private shopRepo: ShopRepository,
		private sessions: SessionRepository,
		private invites: InviteService,
		private limits: PlanLimitService,
	) {}

	/**
	 * GET /shops — the shop list.
	 * @param req The current request.
	 * @returns The Shops/Index page.
	 */
	index(req: Request) {
		return this.#list(req, Account.id(ctx(req).user));
	}

	/**
	 * GET /shops/create — the new-shop form.
	 * @param req The current request.
	 * @returns The Shops/Form page, empty.
	 */
	create(req: Request) {
		return this.#form(req, null);
	}

	/**
	 * POST /shops — add a shop (it gets the default payment methods).
	 * Refused when the account already has as many shops as its plan allows.
	 * With an `owner_email` (platform admin only) the shop is for a new person:
	 * they get their own account and an invitation email.
	 * @param req The current request.
	 * @returns A redirect to the list, the list with the invitation
	 *   link on it, or the form with errors.
	 */
	async store(req: Request) {
		const input = await HttpRequest.body(req);
		const v = validate(ShopInput, input);
		const owner = validate(ShopOwnerInput, input);
		const errors = v.errors ?? owner.errors;
		if (errors) return this.#form(req, null, errors);
		const { user } = ctx(req);
		const email = owner.data!.owner_email;
		if (!email) {
			const full = await this.limits.shopError(Account.id(user));
			if (full) return this.#form(req, null, { name: full });
			await this.shops.create(v.data!, Account.id(user));
			return redirect("/shops");
		}
		if (!Account.isPlatformAdmin(user))
			return new Response(t("server.forbidden"), { status: 403 });
		const r = await this.invites.createShopFor(
			v.data!,
			email,
			Url.originOf(req),
		);
		if (r.errors) return this.#form(req, null, r.errors);
		return this.#list(req, Account.id(user), {
			invite: { email, link: r.link, mail_error: r.mailError },
		});
	}

	/**
	 * GET /shops/:id/edit — the edit form.
	 * It has the name, logo, currency, time zone and tax.
	 * The `#tax` card is where the ⌘K "Tax settings" lands.
	 * @param req The current request.
	 * @returns The Shops/Form page, or 404.
	 */
	async edit(req: BunRequest<"/shops/:id/edit">) {
		const shop = await this.#own(req);
		if (!shop) return HttpResponse.notFoundText();
		return this.#form(req, shop);
	}

	/**
	 * PUT /shops/:id — edit a shop's general settings.
	 * @param req The current request.
	 * @returns A redirect to the list, or the form with errors.
	 */
	async update(req: BunRequest<"/shops/:id">) {
		const v = validate(ShopInput, await HttpRequest.body(req));
		const shop = await this.#own(req);
		if (!shop) return HttpResponse.notFoundText();
		if (v.errors) return this.#form(req, shop, v.errors);
		await this.shops.update(shop.id, v.data);
		return redirect("/shops");
	}

	/**
	 * DELETE /shops/:id — delete a shop.
	 * Refused when it is the last one or still holds products.
	 * @param req The current request.
	 * @returns Back to the list, or the list with the refusal on it.
	 */
	async destroy(req: BunRequest<"/shops/:id">) {
		const shop = await this.#own(req);
		if (!shop) return HttpResponse.notFoundText();
		const owner = Account.id(ctx(req).user);
		const error = await this.shops.remove(shop.id, owner);
		if (error) return this.#list(req, owner, { errors: { shop: error } });
		return back(req, "/shops");
	}

	/**
	 * POST /shops/:id/switch — make this the active shop for the session.
	 * @param req The current request.
	 * @returns A redirect to /pos (loaded as a whole page), or 404 when the shop is gone
	 *   or another account's.
	 */
	async switch(req: BunRequest<"/shops/:id/switch">) {
		const { session, user } = ctx(req);
		const shop = await this.shopRepo.findOwned(
			HttpRequest.idOf(req),
			Account.id(user),
		);
		if (!shop) return HttpResponse.notFoundText();
		if (session) await this.sessions.setShop(session.id, shop.id);
		// a whole page load, like the browser's refresh: nothing of the old shop stays on screen
		return Inertia.away(req, "/pos");
	}

	/**
	 * The shop list, maybe with a message on it.
	 * @param req The current request.
	 * @param owner The account whose shops are listed.
	 * @param extra The message: `invite` or `errors`.
	 * @returns The Shops/Index page.
	 */
	async #list(req: Request, owner: number, extra?: Record<string, unknown>) {
		return inertia(req, "Shops/Index", {
			shops: await this.shops.list(owner),
			...extra,
		});
	}

	/**
	 * One of the signed-in user's shops, from the `:id` in the URL.
	 * @param req The current request.
	 * @returns The shop, or null when it is missing or another account's.
	 */
	#own(req: BunRequest) {
		return this.shopRepo.findOwned(
			HttpRequest.idOf(req),
			Account.id(ctx(req).user),
		);
	}

	/**
	 * The shop form, maybe with errors on it.
	 * @param req The current request.
	 * @param shop The shop being edited, or null for a new one.
	 * @param errors Inertia errors to show, if any.
	 * @returns The Shops/Form page.
	 */
	#form(req: Request, shop: Shop | null, errors?: Errors) {
		return inertia(req, "Shops/Form", {
			shop,
			timezones: TIMEZONES,
			...(errors && { errors }),
		});
	}
}
