import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { inertia, redirect } from "@xcore/view/Inertia";
import { MailService } from "@services/settings/Mail.Service";
import { MailerRegistry } from "@mail/Mailer.Registry";
import { MailInput, TestMailInput } from "@validators/Mail.Validator";
import { TestEmail } from "@emails/Test.Email";
import { validate, type Errors } from "@validators/validate";

/**
 * The email pages.
 * `/email` = the platform's setup.
 * It is in the `platform` group: only the platform admin gets here.
 * `/shop-email` = the active shop's own setup (the `admin` group).
 * Without one the shop sends through the platform's.
 * Both use the Email/Index page.
 */
@Service()
export class EmailController {
	constructor(
		private mail: MailService,
		private mailers: MailerRegistry,
	) {}

	/**
	 * GET /email — the platform's outgoing email.
	 * @param req The current request.
	 * @returns The Email/Index page.
	 */
	index(req: BunRequest) {
		return this.#show(req, false);
	}

	/**
	 * PUT /email — save the platform's sender domain and every provider's keys.
	 * @param req The current request.
	 * @returns A redirect back to /email, or the page with errors.
	 */
	update(req: BunRequest) {
		return this.#save(req, false);
	}

	/**
	 * POST /email/test — send one message through the platform's setup.
	 * @param req The current request.
	 * @returns A redirect back to /email, or the page with the failure on it.
	 */
	test(req: BunRequest) {
		return this.#sendTest(req, false);
	}

	/**
	 * GET /shop-email — the active shop's own outgoing email.
	 * @param req The current request.
	 * @returns The Email/Index page.
	 */
	shopIndex(req: BunRequest) {
		return this.#show(req, true);
	}

	/**
	 * PUT /shop-email — save the active shop's sender and every provider's keys.
	 * @param req The current request.
	 * @returns A redirect back to /shop-email, or the page with errors.
	 */
	shopUpdate(req: BunRequest) {
		return this.#save(req, true);
	}

	/**
	 * POST /shop-email/test — send one message the way the active shop's email
	 * goes out.
	 * @param req The current request.
	 * @returns A redirect back to /shop-email, or the page with the failure on it.
	 */
	shopTest(req: BunRequest) {
		return this.#sendTest(req, true);
	}

	/**
	 * The page's props.
	 * @param req The current request.
	 * @param own True for the active shop's setup, false for the platform's.
	 * @returns The stored `mail` settings and the `mailers` catalogue.
	 *   For a shop also the address it sends from without its own setup.
	 */
	async #props(req: BunRequest, own: boolean) {
		const shop = own ? ctx(req).shop : null;
		return {
			mail: await this.mail.settings(shop?.id),
			mailers: this.mailers.meta(),
			shop_mail: shop && {
				name: shop.name,
				fallback: await this.mail.platformAddress(),
			},
		};
	}

	/**
	 * The page URL.
	 * @param own True for the active shop's setup.
	 * @returns `/shop-email` or `/email`.
	 */
	#url(own: boolean) {
		return own ? "/shop-email" : "/email";
	}

	/**
	 * Show one setup, maybe with errors on it.
	 * @param req The current request.
	 * @param own True for the active shop's setup.
	 * @param errors Inertia errors to show, if any.
	 * @returns The Email/Index page.
	 */
	async #show(req: BunRequest, own: boolean, errors?: Errors) {
		return inertia(req, "Email/Index", {
			...(errors && { errors }),
			...(await this.#props(req, own)),
		});
	}

	/**
	 * Save one setup.
	 * @param req The current request.
	 * @param own True for the active shop's setup.
	 * @returns A redirect back to the page, or the page with errors.
	 */
	async #save(req: BunRequest, own: boolean) {
		const v = validate(MailInput, await HttpRequest.body(req));
		const shopId = own ? ctx(req).shop.id : undefined;
		const errors = v.errors ?? (await this.mail.update(v.data!, shopId)).errors;
		if (errors) return this.#show(req, own, errors);
		return redirect(this.#url(own));
	}

	/**
	 * Send one test message.
	 * @param req The current request.
	 * @param own True to send it as the active shop.
	 * @returns A redirect back to the page, or the page with the failure on it.
	 */
	async #sendTest(req: BunRequest, own: boolean) {
		const v = validate(TestMailInput, await HttpRequest.body(req));
		const shop = own ? ctx(req).shop : null;
		const error = v.errors
			? v.errors.to
			: await this.mail.send(new TestEmail(v.data.to, shop));
		if (error) return this.#show(req, own, { to: error });
		return redirect(this.#url(own));
	}
}
