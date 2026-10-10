import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { HttpResponse, json } from "@xcore/http/Response";
import { Url } from "@xcore/http/Url";
import { t } from "@xcore/i18n/I18n";
import { redirect } from "@xcore/view/Inertia";
import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { AuthController } from "@controllers/Auth.Controller";
import { PasskeyService } from "@services/settings/Passkey.Service";
import {
	PasskeyLoginInput,
	PasskeyOptionsInput,
	PasskeyRegisterInput,
} from "@validators/Passkey.Validator";
import { validate } from "@validators/validate";

/**
 * Passkeys: signing in with one,
 * and the Passkeys section of /settings.
 */
@Service()
export class PasskeyController {
	constructor(
		private passkeys: PasskeyService,
		private auth: AuthController,
	) {}

	/**
	 * POST /login/passkey/options — a fresh challenge for the sign-in.
	 * A POST because it leaves a challenge on the server.
	 * @param req The current request.
	 * @returns JSON options for `navigator.credentials.get`.
	 */
	loginOptions(req: BunRequest) {
		return json(this.passkeys.loginOptions(Url.originOf(req)));
	}

	/**
	 * POST /login/passkey — check the passkey's answer and open a session.
	 * Every failure says the same, so nobody learns which passkeys exist.
	 * @param req The current request.
	 * @returns A redirect to /pos, or the login form with an error.
	 */
	async login(req: BunRequest) {
		const failed = { passkey: t("server.passkey_failed") };
		const v = validate(PasskeyLoginInput, await HttpRequest.body(req));
		if (v.errors) return this.auth.loginPage(req, failed);
		const user = await this.passkeys.login(v.data, Url.originOf(req));
		if (!user) return this.auth.loginPage(req, failed);
		if (user === "disabled")
			return this.auth.loginPage(req, {
				passkey: t("server.auth_account_disabled"),
			});
		return this.auth.signedIn(req, user);
	}

	/**
	 * POST /settings/passkeys/options — start adding a passkey.
	 * The current password is checked here, before the device is asked.
	 * @param req The current request.
	 * @returns JSON options for `navigator.credentials.create`,
	 *   or 422 with errors.
	 */
	async registerOptions(req: BunRequest) {
		const v = validate(PasskeyOptionsInput, await HttpRequest.body(req));
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		const r = await this.passkeys.registerOptions(
			ctx(req).user,
			v.data.current_password,
			Url.originOf(req),
		);
		return r.errors ? HttpResponse.unprocessable(r.errors) : json(r.options);
	}

	/**
	 * POST /settings/passkeys — save the passkey the device made.
	 * @param req The current request.
	 * @returns A redirect to the Passkeys section, or the page with errors.
	 */
	async register(req: BunRequest) {
		const v = validate(PasskeyRegisterInput, await HttpRequest.body(req));
		const errors =
			v.errors ??
			(await this.passkeys.register(ctx(req).user, v.data, Url.originOf(req)));
		if (errors) return this.auth.settingsPage(req, "passkeys", errors);
		return redirect("/settings?section=passkeys");
	}

	/**
	 * DELETE /settings/passkeys/:id — delete one of your own passkeys.
	 * @param req The current request.
	 * @returns A redirect to the Passkeys section.
	 */
	async destroy(req: BunRequest<"/settings/passkeys/:id">) {
		await this.passkeys.remove(ctx(req).user.id, HttpRequest.idOf(req));
		return redirect("/settings?section=passkeys");
	}
}
