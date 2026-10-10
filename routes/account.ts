import { Guard } from "@xcore/auth/Guard";
import { router } from "@xcore/http/Router";
import { AuthController } from "@controllers/Auth.Controller";
import { PasskeyController } from "@controllers/Passkey.Controller";
import { HealthController } from "@controllers/Health.Controller";
import { LocaleController } from "@controllers/Locale.Controller";
import { CurrencyController } from "@controllers/Currency.Controller";
import { SearchController } from "@controllers/Search.Controller";
import { limit, loginLimit } from "./limits";

/**
 * Forgot password: the page of the emailed link,
 * where the person picks a new password.
 * Inside the `passwordReset` limit.
 */
function resetRoutes() {
	router.get("/reset-password/:token", [AuthController, "showReset"]);
	router.post("/reset-password/:token", [AuthController, "reset"]);
}

/**
 * A new shop owner's invitation link:
 * pick a name and a password, then signed in.
 * Inside the `invite` limit.
 */
function inviteRoutes() {
	router.get("/invite/:token", [AuthController, "showInvite"]);
	router.post("/invite/:token", [AuthController, "acceptInvite"]);
}

/**
 * Self sign-up: a new owner and their first shop.
 * 404 while the platform admin has it off.
 * Inside the `signup` limit.
 */
function signupRoutes() {
	router.get("/register", [AuthController, "showRegister"]);
	router.post("/register", [AuthController, "register"]);
	/** Sign-up with a Google or Microsoft sign-in: no password, no email link. */
	router.post("/register/google", [AuthController, "registerGoogle"]);
	router.post("/register/microsoft", [AuthController, "registerMicrosoft"]);
	/** The link in the sign-up email. */
	router.get("/confirm/:token", [AuthController, "confirm"]);
}

/** The signed-in user's own settings, and the search. Inside `auth`. */
function ownRoutes() {
	router.get("/settings", [AuthController, "showSettings"]);
	router.put("/settings/profile", [AuthController, "updateProfile"]);
	router.put("/settings/password", [AuthController, "updatePassword"]);
	/**
	 * The user's own passkeys.
	 * Adding one checks the password, so it is limited.
	 */
	router.post("/settings/passkeys/options", [PasskeyController, "registerOptions"], limit("passkey"));
	router.post("/settings/passkeys", [PasskeyController, "register"], limit("passkey"));
	router.delete("/settings/passkeys/:id", [PasskeyController, "destroy"]);
	/**
	 * The user's own Microsoft account, for signing in.
	 * Connecting one checks the password, so it is limited.
	 */
	router.post("/settings/microsoft", [AuthController, "connectMicrosoft"], limit("passkey"));
	router.delete("/settings/microsoft", [AuthController, "disconnectMicrosoft"]);
	/** The ⌘K palette: records of the active shop, role-aware. */
	router.get("/search", [SearchController, "index"], limit("search"));
}

/**
 * Health, the language switcher, sign-in and sign-out,
 * the signed-in user's own settings (`/settings`),
 * and the app-wide ⌘K search.
 */
export function accountRoutes() {
	router.get("/health", [HealthController, "check"]);
	/** The language switcher. Public: the storefront has one too. */
	router.post("/lang", [LocaleController, "set"]);
	/** The storefront's currency switcher. Public, display only. */
	router.post("/currency", [CurrencyController, "set"]);
	router.get("/login", [AuthController, "showLogin"]);
	router.post("/login", [AuthController, "login"], loginLimit);
	/**
	 * Sign in with a passkey: ask for a challenge,
	 * then send the device's answer.
	 * A failed answer burns the same budget as a wrong password.
	 */
	router.post("/login/passkey/options", [PasskeyController, "loginOptions"], limit("passkey"));
	router.post("/login/passkey", [PasskeyController, "login"], loginLimit);
	/**
	 * Sign in with Google or Microsoft:
	 * the browser sends the Firebase ID token.
	 * A failed one burns the same budget as a wrong password.
	 */
	router.post("/login/google", [AuthController, "google"], loginLimit);
	router.post("/login/microsoft", [AuthController, "microsoft"], loginLimit);
	/**
	 * Forgot password: ask for the link by email,
	 * then pick a new password on the link's page.
	 */
	router.get("/forgot-password", [AuthController, "showForgot"]);
	router.post("/forgot-password", [AuthController, "forgot"], limit("passwordForgot"));
	router.group(limit("passwordReset"), resetRoutes);
	router.group(limit("invite"), inviteRoutes);
	router.group(limit("signup"), signupRoutes);

	/**
	 * Signed in but maybe not confirmed yet:
	 * these still work on the "Confirm your email" screen.
	 */
	router.post("/logout", [AuthController, "logout"], Guard.signedIn);
	router.post("/confirm/resend", [AuthController, "resendConfirmation"], Guard.signedIn, limit("confirmResend"));

	router.group(Guard.auth, ownRoutes);
}
