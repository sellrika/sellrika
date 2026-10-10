import { Auth } from "@xcore/auth/Auth";
import { ctx } from "@xcore/http/Context";
import { HttpRequest, Query } from "@xcore/http/Request";
import { Url } from "@xcore/http/Url";
import { t } from "@xcore/i18n/I18n";
import { back, inertia, Inertia, redirect } from "@xcore/view/Inertia";
import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { AuthService } from "@services/settings/Auth.Service";
import { InviteService } from "@services/settings/Invite.Service";
import { SignupService } from "@services/settings/Signup.Service";
import { UserRepository } from "@repositories/User.Repository";
import {
	LoginInput,
	MicrosoftConnectInput,
	PasswordInput,
	ProfileInput,
} from "@validators/Auth.Validator";
import {
	AcceptInviteInput,
	ForgotPasswordInput,
	ProviderRegisterInput,
	RegisterInput,
	ResetPasswordInput,
	SignupSettingInput,
} from "@validators/User.Validator";
import { Hooks } from "@xcore/hooks/Hooks";
import { PasskeyService } from "@services/settings/Passkey.Service";
import { TIMEZONES } from "@constants/Shop.Constant";
import { Guard } from "@xcore/auth/Guard";
import { StoreLoginInput } from "@validators/Store.Validator";
import { app } from "@config/app";
import { validate, type Errors } from "@validators/validate";
import type { User } from "@models/User";

/**
 * Signing in and out, "forgot password", accepting an invitation
 * and self sign-up.
 * Also the /settings page: own profile and password.
 */
@Service()
export class AuthController {
	constructor(
		private auth: AuthService,
		private users: UserRepository,
		private invites: InviteService,
		private signup: SignupService,
		private passkeys: PasskeyService,
	) {}

	/**
	 * Open a session for a user and go to the POS.
	 * A guest who was sent here from another page goes back to that page
	 * (`Guard.comeBack`).
	 * Also used by the passkey sign-in (Passkey.Controller).
	 * @param req The current request.
	 * @param user Who signs in.
	 * @returns A redirect to /pos, or to the remembered page.
	 */
	async signedIn(req: BunRequest, user: User) {
		await Auth.login(req, user);
		const next = req.cookies.get(Guard.nextCookie());
		req.cookies.delete(Guard.nextCookie(), { path: "/" });
		// a path on this site only, never another host
		return redirect(Url.samePath(next, "/pos"));
	}

	/**
	 * GET /login — the login form.
	 * A user who is already signed in goes straight to the POS.
	 * @param req The current request.
	 * @returns The Auth/Login page, or a redirect.
	 */
	async showLogin(req: BunRequest) {
		if (await Auth.current(req)) return redirect("/pos");
		return this.loginPage(req);
	}

	/**
	 * The login form, with the "Create an account" link while sign-up is on.
	 * Also used by the login rate limit (routes/limits.ts).
	 * @param req The current request.
	 * @param errors Errors to show, if any.
	 * @param status The HTTP status.
	 * @param notice A message to show above the form, if any.
	 * @returns The Auth/Login page.
	 */
	async loginPage(
		req: Request,
		errors: Errors = {},
		status = 200,
		notice: string | null = null,
	) {
		const signup = await this.signup.enabled();
		// the Firebase web config is public; null = no Google button
		const { apiKey, authDomain, projectId, appId } = app.firebase;
		const google = apiKey ? { apiKey, authDomain, projectId, appId } : null;
		// the Microsoft button uses the same config
		const microsoft = !!google && app.firebase.microsoft;
		const props = { signup, google, microsoft, notice, errors };
		return inertia(req, "Auth/Login", props, status);
	}

	/**
	 * POST /login/google — sign in with a Google account.
	 * @param req The current request.
	 * @returns A redirect to /pos, the login form with an error,
	 *   or the not-found page while Google sign-in is off.
	 */
	async google(req: BunRequest) {
		if (!app.firebase.apiKey) return Inertia.notFound(req);
		return this.#firebaseLogin(req, "google");
	}

	/**
	 * POST /login/microsoft — sign in with a Microsoft account.
	 * @param req The current request.
	 * @returns A redirect to /pos, the login form with an error,
	 *   or the not-found page while Microsoft sign-in is off.
	 */
	async microsoft(req: BunRequest) {
		if (!app.firebase.apiKey || !app.firebase.microsoft)
			return Inertia.notFound(req);
		return this.#firebaseLogin(req, "microsoft");
	}

	/**
	 * Sign in with the Firebase ID token in the body.
	 * Every failure says the same, so nobody learns which emails exist.
	 * @param req The current request.
	 * @param via The button used. It names the error's field and text.
	 * @returns A redirect to /pos, or the login form with an error.
	 */
	async #firebaseLogin(req: BunRequest, via: "google" | "microsoft") {
		const v = validate(StoreLoginInput, await HttpRequest.body(req));
		const user = v.errors ? null : await this.auth.firebaseSignIn(v.data.token);
		// nobody has this sign-in yet: the page goes on to the create-shop step
		if (user === "new" && (await this.signup.enabled()))
			return this.loginPage(req, { signup: via });
		if (!user || user === "new")
			return this.loginPage(req, { [via]: t(`server.${via}_failed`) });
		if (user === "disabled")
			return this.loginPage(req, {
				[via]: t("server.auth_account_disabled"),
			});
		return this.signedIn(req, user);
	}

	/**
	 * POST /login — check the credentials and open a session.
	 * @param req The current request.
	 * @returns A redirect to /pos, or the login form with errors.
	 */
	async login(req: BunRequest) {
		const v = validate(LoginInput, await HttpRequest.body(req));
		if (v.errors) return this.loginPage(req, v.errors);
		const user = await this.auth.attempt(v.data);
		if (!user)
			return this.loginPage(req, {
				email: t("server.auth_bad_credentials"),
			});
		if (user === "disabled")
			return this.loginPage(req, {
				email: t("server.auth_account_disabled"),
			});
		return this.signedIn(req, user);
	}

	/**
	 * GET /forgot-password — the form that asks for the email.
	 * @param req The current request.
	 * @returns The Auth/Forgot page, or a redirect to the POS when signed in.
	 */
	async showForgot(req: BunRequest) {
		if (await Auth.current(req)) return redirect("/pos");
		return inertia(req, "Auth/Forgot", { sent: false });
	}

	/**
	 * POST /forgot-password — email the link to pick a new password.
	 * The page says the same for every email,
	 * so nobody learns which emails have an account.
	 * @param req The current request.
	 * @returns The Auth/Forgot page: "sent", or the errors.
	 */
	async forgot(req: BunRequest) {
		const v = validate(ForgotPasswordInput, await HttpRequest.body(req));
		if (v.errors)
			return inertia(req, "Auth/Forgot", { sent: false, errors: v.errors });
		const error = await this.auth.forgot(v.data.email, Url.originOf(req));
		if (error)
			return inertia(req, "Auth/Forgot", {
				sent: false,
				errors: { email: t("server.auth_reset_no_mail") },
			});
		return inertia(req, "Auth/Forgot", { sent: true });
	}

	/**
	 * GET /reset-password/:token — the page with the new password.
	 * @param req The current request.
	 * @returns The Auth/Reset page.
	 *   `email` is null when the link no longer works.
	 */
	async showReset(req: BunRequest<"/reset-password/:token">) {
		const user = await this.auth.resettable(req.params.token);
		return inertia(req, "Auth/Reset", { email: user?.email ?? null });
	}

	/**
	 * POST /reset-password/:token — save the new password, then signed in.
	 * Every other device of the person is signed out.
	 * @param req The current request.
	 * @returns A redirect to /pos, or the page with errors.
	 */
	async reset(req: BunRequest<"/reset-password/:token">) {
		const token = req.params.token;
		const known = await this.auth.resettable(token);
		if (!known) return inertia(req, "Auth/Reset", { email: null });
		const v = validate(ResetPasswordInput, await HttpRequest.body(req));
		if (v.errors)
			return inertia(req, "Auth/Reset", {
				email: known.email,
				errors: v.errors,
			});
		const user = await this.auth.resetPassword(token, v.data.password);
		if (!user) return inertia(req, "Auth/Reset", { email: null });
		return this.signedIn(req, user);
	}

	/**
	 * GET /invite/:token — the invitation page of a new shop owner.
	 * @param req The current request.
	 * @returns The Auth/Invite page.
	 *   `email` is null when the link no longer works.
	 */
	async showInvite(req: BunRequest<"/invite/:token">) {
		const user = await this.invites.invited(req.params.token);
		return inertia(req, "Auth/Invite", { email: user?.email ?? null });
	}

	/**
	 * POST /invite/:token — take the invitation.
	 * The person picks a name and a password, then is signed in.
	 * @param req The current request.
	 * @returns A redirect to /pos, or the page with errors.
	 */
	async acceptInvite(req: BunRequest<"/invite/:token">) {
		const user = await this.invites.invited(req.params.token);
		if (!user) return inertia(req, "Auth/Invite", { email: null });
		const v = validate(AcceptInviteInput, await HttpRequest.body(req));
		if (v.errors)
			return inertia(req, "Auth/Invite", {
				email: user.email,
				errors: v.errors,
			});
		await this.invites.accept(req.params.token, v.data);
		return this.signedIn(req, user);
	}

	/**
	 * GET /register — the self sign-up form.
	 * Not found while sign-up is off; a signed-in user goes to the POS.
	 * @param req The current request.
	 * @returns The Auth/Register page, a redirect, or the not-found page.
	 */
	async showRegister(req: BunRequest) {
		if (!(await this.signup.enabled())) return Inertia.notFound(req);
		if (await Auth.current(req)) return redirect("/pos");
		return inertia(req, "Auth/Register", this.#registerProps());
	}

	/**
	 * POST /register — create an account and its first shop.
	 * It emails the confirmation link, then the person is signed in.
	 * Every app page shows "Confirm your email" until the link is
	 * opened (the `auth` middleware).
	 * @param req The current request.
	 * @returns A redirect to /pos, the page with errors, or the not-found page.
	 */
	async register(req: BunRequest) {
		if (!(await this.signup.enabled())) return Inertia.notFound(req);
		const v = validate(RegisterInput, await HttpRequest.body(req));
		const r = v.errors
			? { errors: v.errors }
			: await this.signup.register(v.data!, Url.originOf(req));
		if (r.errors)
			return inertia(req, "Auth/Register", {
				...this.#registerProps(),
				errors: r.errors,
			});
		return this.signedIn(req, r.user!);
	}

	/**
	 * POST /register/google — create an account with a Google sign-in.
	 * @param req The current request.
	 * @returns A redirect to /pos, the page with errors, or the not-found page.
	 */
	async registerGoogle(req: BunRequest) {
		if (!app.firebase.apiKey) return Inertia.notFound(req);
		return this.#firebaseRegister(req);
	}

	/**
	 * POST /register/microsoft — create an account with a Microsoft sign-in.
	 * @param req The current request.
	 * @returns A redirect to /pos, the page with errors, or the not-found page.
	 */
	async registerMicrosoft(req: BunRequest) {
		if (!app.firebase.apiKey || !app.firebase.microsoft)
			return Inertia.notFound(req);
		return this.#firebaseRegister(req);
	}

	/**
	 * Create an account and its first shop from the Firebase ID token
	 * in the body. The person is signed in at once:
	 * the provider proved the email, so there is no confirmation link.
	 * @param req The current request.
	 * @returns A redirect to /pos, the page with errors, or the not-found page.
	 */
	async #firebaseRegister(req: BunRequest) {
		if (!(await this.signup.enabled())) return Inertia.notFound(req);
		const v = validate(ProviderRegisterInput, await HttpRequest.body(req));
		const r = v.errors
			? { errors: v.errors }
			: await this.signup.registerProvider(v.data!);
		if (r.errors)
			return inertia(req, "Auth/Register", {
				...this.#registerProps(),
				errors: r.errors,
			});
		return this.signedIn(req, r.user!);
	}

	/**
	 * GET /confirm/:token — the link in the sign-up email.
	 * A GET because it is opened from an email.
	 * The secret token is what guards it, so no CSRF risk.
	 * It confirms only for the signed-in owner of the link.
	 * A mail scanner, or anyone else who opens it, changes nothing:
	 * they are asked to sign in, whatever the link is.
	 * @param req The current request.
	 * @returns The POS when signed in and confirmed.
	 *   The Auth/Confirm page when the link is not theirs or too old.
	 *   The login page when nobody is signed in.
	 */
	async confirm(req: BunRequest<"/confirm/:token">) {
		const c = await Auth.current(req);
		if (!c)
			return this.loginPage(req, {}, 200, t("server.auth_confirm_sign_in"));
		const ok = await this.signup.confirm(req.params.token, c.user.id);
		// already confirmed (the link opened again): nothing to show
		if (ok || c.user.email_verified_at) return redirect("/pos");
		return inertia(req, "Auth/Confirm", {
			email: c.user.email,
			error: t("server.auth_confirm_link_invalid"),
		});
	}

	/**
	 * POST /confirm/resend — email a new confirmation link.
	 * The old one stops working.
	 * @param req The current request.
	 * @returns The Auth/Confirm page saying it was sent (or why not),
	 *   or the POS when already confirmed.
	 */
	async resendConfirmation(req: BunRequest<"/confirm/resend">) {
		const { user } = ctx(req);
		if (user.email_verified_at) return redirect("/pos");
		const error = await this.signup.sendConfirmation(user, Url.originOf(req));
		return inertia(req, "Auth/Confirm", {
			email: user.email,
			resent: !error,
			error,
		});
	}

	/**
	 * PUT /owners/signup — switch self sign-up on or off.
	 * Platform admin only (routed inside the platform group).
	 * @param req The current request.
	 * @returns A redirect back to the page it came from.
	 */
	async updateSignup(req: BunRequest) {
		const v = validate(SignupSettingInput, await HttpRequest.body(req));
		if (!v.errors) await this.signup.setEnabled(v.data.enabled);
		return back(req, "/owners");
	}

	/**
	 * POST /logout — close this session.
	 * @param req The current request.
	 * @returns A redirect to /login.
	 */
	async logout(req: BunRequest) {
		await Auth.logout(req);
		return redirect("/login");
	}

	/**
	 * The settings page, always with the user's passkeys.
	 * Also used by the passkey routes (Passkey.Controller).
	 * @param req The current request.
	 * @param section The active card of the settings rail, or null.
	 * @param errors Errors to show, if any.
	 * @returns The Settings/Index page.
	 */
	async settingsPage(req: BunRequest, section: string | null, errors?: Errors) {
		const userId = ctx(req).user.id;
		const passkeys = await this.passkeys.list(userId);
		const { apiKey, authDomain, projectId, appId } = app.firebase;
		// null = no Microsoft section
		const microsoft = this.#microsoftOn()
			? {
					connected: await this.auth.providerConnected(userId),
					firebase: { apiKey, authDomain, projectId, appId },
				}
			: null;
		return inertia(req, "Settings/Index", {
			section,
			passkeys,
			microsoft,
			...(errors ? { errors } : {}),
		});
	}

	/**
	 * Is "Continue with Microsoft" on?
	 * @returns True when Firebase is set up and `FIREBASE_MICROSOFT` is 1.
	 */
	#microsoftOn() {
		return !!app.firebase.apiKey && app.firebase.microsoft;
	}

	/**
	 * POST /settings/microsoft — connect your Microsoft account.
	 * The current password is checked first.
	 * @param req The current request.
	 * @returns A redirect to the Microsoft section, the page with errors,
	 *   or the not-found page while Microsoft sign-in is off.
	 */
	async connectMicrosoft(req: BunRequest) {
		if (!this.#microsoftOn()) return Inertia.notFound(req);
		const v = validate(MicrosoftConnectInput, await HttpRequest.body(req));
		const errors =
			v.errors ??
			(await this.auth.connectProvider(
				ctx(req).user,
				v.data.current_password,
				v.data.token,
			));
		if (errors) return this.settingsPage(req, "microsoft", errors);
		return redirect("/settings?section=microsoft");
	}

	/**
	 * DELETE /settings/microsoft — take your Microsoft account off.
	 * @param req The current request.
	 * @returns A redirect to the Microsoft section.
	 */
	async disconnectMicrosoft(req: BunRequest) {
		await this.auth.disconnectProvider(ctx(req).user.id);
		return redirect("/settings?section=microsoft");
	}

	/**
	 * GET /settings?section= — the settings rail.
	 * `?section=` picks the active card.
	 * @param req The current request.
	 * @returns The Settings/Index page.
	 */
	async showSettings(req: BunRequest) {
		return this.settingsPage(req, new Query(req).raw("section"));
	}

	/**
	 * PUT /settings/profile — rename yourself.
	 * @param req The current request.
	 * @returns A redirect to /settings, or the page with errors.
	 */
	async updateProfile(req: BunRequest) {
		const v = validate(ProfileInput, await HttpRequest.body(req));
		if (v.errors) return this.settingsPage(req, "profile", v.errors);
		await this.users.updateName(ctx(req).user.id, v.data.name);
		return redirect("/settings");
	}

	/**
	 * PUT /settings/password — change your own password.
	 * Every other device is signed out.
	 * @param req The current request.
	 * @returns A redirect to /settings, or the page with errors.
	 */
	async updatePassword(req: BunRequest) {
		const { user, session } = ctx(req);
		const v = validate(PasswordInput, await HttpRequest.body(req));
		if (v.errors) return this.settingsPage(req, "password", v.errors);
		const err = await this.auth.changePassword(user, session?.id ?? "", v.data);
		if (err)
			return this.settingsPage(req, "password", { current_password: err });
		return redirect("/settings");
	}

	/**
	 * What the sign-up form needs.
	 * `signup` = an add-on's note and whether to ask for the terms.
	 * `google` = the Firebase web config, null = no provider buttons.
	 * `microsoft` = show "Continue with Microsoft" too.
	 * @returns The props of Auth/Register.
	 */
	#registerProps() {
		const { apiKey, authDomain, projectId, appId } = app.firebase;
		const google = apiKey ? { apiKey, authDomain, projectId, appId } : null;
		return {
			google,
			microsoft: !!google && app.firebase.microsoft,
			timezones: TIMEZONES,
			signup: Hooks.signup(),
		};
	}
}
