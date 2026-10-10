import type { FirebaseConfig } from "@/types";
import type { StoreApi, StoreData } from "./types";

/**
 * The Firebase JS SDK, compat build (the `firebase` global).
 * It is loaded on the first sign-in click only.
 * Mirror of FIREBASE_SDK_VERSION in app/constants/Store.Constant.ts.
 */
const SDK = "https://www.gstatic.com/firebasejs/10.14.1";

/** The slice of a Firebase user this file touches. */
type FirebaseUser = {
	getIdToken(): Promise<string>;
	sendEmailVerification(): Promise<void>;
	emailVerified: boolean;
};

/** The slice of Firebase auth this file touches. */
type FirebaseAuth = {
	currentUser: FirebaseUser | null;
	signInWithPopup(p: unknown): Promise<{ user: FirebaseUser }>;
	signInWithEmailAndPassword(
		email: string,
		password: string,
	): Promise<{ user: FirebaseUser }>;
	createUserWithEmailAndPassword(
		email: string,
		password: string,
	): Promise<{ user: FirebaseUser }>;
	sendPasswordResetEmail(email: string): Promise<void>;
};

/** The `firebase` global of the compat SDK. */
type FirebaseGlobal = {
	apps: unknown[];
	initializeApp(cfg: Record<string, string>): void;
	auth: (() => FirebaseAuth) & {
		GoogleAuthProvider: new () => unknown;
		OAuthProvider: new (id: string) => unknown;
	};
};

/** What a sign-in call ends with. */
type Result = { error?: string; notice?: string; unverified?: boolean };

/**
 * Firebase's error codes → the key of one plain line for the dialog.
 */
const MESSAGES: Record<string, string> = {
	"auth/invalid-email": "customer_auth.invalid_email",
	"auth/user-not-found": "customer_auth.user_not_found",
	"auth/wrong-password": "customer_auth.wrong_password",
	"auth/invalid-credential": "customer_auth.wrong_password",
	"auth/invalid-login-credentials": "customer_auth.wrong_password",
	"auth/email-already-in-use": "customer_auth.email_in_use",
	"auth/weak-password": "customer_auth.weak_password",
	"auth/missing-password": "customer_auth.missing_password",
	"auth/too-many-requests": "customer_auth.too_many_requests",
	"auth/popup-closed-by-user": "customer_auth.popup_closed",
	"auth/cancelled-popup-request": "customer_auth.popup_closed",
	"auth/popup-blocked": "customer_auth.popup_blocked",
	"auth/account-exists-with-different-credential":
		"customer_auth.different_credential",
	"auth/network-request-failed": "customer_auth.network_failed",
	"auth/operation-not-allowed": "customer_auth.not_allowed",
	"auth/unauthorized-domain": "customer_auth.unauthorized_domain",
};

/**
 * Customer sign-in on the store, through the shop's Firebase project.
 * On success the server sets the session cookie and the page reloads.
 * @param data The data island (base URL and Firebase config).
 * @param t The store's `t()`.
 * @param loadScript Loads an outside script once.
 * @returns `window.Store.auth`.
 */
export function createAuth(
	data: StoreData,
	t: StoreApi["t"],
	loadScript: StoreApi["loadScript"],
): StoreApi["auth"] {
	const base = data.store.base;

	/** @returns The shop's Firebase config. Throws when sign-in is off. */
	function config(): FirebaseConfig {
		const login = data.store.login;
		if (!login) throw new Error(t("customer_auth.failed"));
		return login.firebase;
	}

	/** @returns The shop's Firebase app, set up once. */
	async function firebase(): Promise<FirebaseGlobal> {
		const cfg = config();
		await loadScript(`${SDK}/firebase-app-compat.js`);
		await loadScript(`${SDK}/firebase-auth-compat.js`);
		const fb = (window as unknown as { firebase?: FirebaseGlobal }).firebase;
		if (!fb) throw new Error(t("customer_auth.sdk_failed"));
		if (!fb.apps.length)
			fb.initializeApp({
				apiKey: cfg.api_key,
				authDomain: cfg.auth_domain,
				projectId: cfg.project_id,
				appId: cfg.app_id,
			});
		return fb;
	}

	/**
	 * A thrown error as one line for the dialog.
	 * @param e The error (a Firebase error has a `code`).
	 * @returns The translated message.
	 */
	function message(e: unknown) {
		const code = (e as { code?: string } | null)?.code ?? "";
		// the raw error stays in the console for whoever has to debug it
		console.error("[sign-in]", e);
		const key = MESSAGES[code];
		if (key) return t(key);
		if (e instanceof Error && e.message) return e.message;
		return t("customer_auth.failed");
	}

	/**
	 * Give the Firebase ID token to the server, which sets the cookie.
	 * On success the page reloads signed in.
	 * @param user The signed-in Firebase user.
	 * @returns An error to show; nothing on success.
	 */
	async function finish(user: FirebaseUser): Promise<Result> {
		const res = await fetch(`${base}/account/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token: await user.getIdToken() }),
		});
		// a 429 is plain text, everything else JSON
		const text = await res.text();
		let body: {
			customer?: unknown;
			errors?: Record<string, string>;
			unverified?: boolean;
		} = {};
		try {
			body = JSON.parse(text);
		} catch {
			// plain text
		}
		if (res.ok && body.customer) {
			location.reload();
			return {};
		}
		const first = Object.values(body.errors ?? {})[0];
		return {
			error:
				body.errors?.token ??
				first ??
				(text && text.length < 200 ? text : t("customer_auth.failed")),
			unverified: !!body.unverified,
		};
	}

	/**
	 * Run a Firebase step and turn a throw into `{ error }`.
	 * @param step The step.
	 * @returns What the step returned, or the error.
	 */
	async function attempt(step: () => Promise<Result>): Promise<Result> {
		try {
			return await step();
		} catch (e) {
			return { error: message(e) };
		}
	}

	/**
	 * Sign in: Google / Microsoft by pop-up, or email + password.
	 * @param provider The provider.
	 * @param creds Email and password (email only).
	 * @returns `{ error, unverified }` when refused; nothing on success.
	 */
	function signIn(
		provider: "google" | "microsoft" | "email",
		creds?: { email: string; password: string },
	) {
		return attempt(async function run() {
			const fb = await firebase();
			if (provider === "email") {
				const email = creds?.email.trim() ?? "";
				const password = creds?.password ?? "";
				const r = await fb.auth().signInWithEmailAndPassword(email, password);
				return finish(r.user);
			}
			const p =
				provider === "google"
					? new fb.auth.GoogleAuthProvider()
					: new fb.auth.OAuthProvider("microsoft.com");
			const r = await fb.auth().signInWithPopup(p);
			return finish(r.user);
		});
	}

	/**
	 * Create an email account. Firebase emails a link to confirm it.
	 * The server refuses the sign-in until the link is clicked.
	 * @param creds Email and password.
	 * @returns `{ notice }` to show, or `{ error }`.
	 */
	function signUp(creds: { email: string; password: string }) {
		return attempt(async function run() {
			const fb = await firebase();
			const email = creds.email.trim();
			const r = await fb
				.auth()
				.createUserWithEmailAndPassword(email, creds.password);
			if (r.user.emailVerified) return finish(r.user);
			await r.user.sendEmailVerification();
			return { notice: t("customer_auth.verify_notice") };
		});
	}

	/**
	 * "Forgot password": Firebase emails the reset link.
	 * @param email The account's email.
	 * @returns `{ notice }` or `{ error }`.
	 */
	function resetPassword(email: string) {
		return attempt(async function run() {
			const fb = await firebase();
			await fb.auth().sendPasswordResetEmail(email.trim());
			return { notice: t("store_ui.reset_sent") };
		});
	}

	/**
	 * Send the confirm link again after a refused sign-in.
	 * @returns `{ notice }` or `{ error }`.
	 */
	function resendVerification() {
		return attempt(async function run() {
			const fb = await firebase();
			await fb.auth().currentUser?.sendEmailVerification();
			return { notice: t("store_ui.verification_sent") };
		});
	}

	/** @returns The sign-in providers the shop has on ([] = off). */
	function providers() {
		return data.store.login?.providers ?? [];
	}

	return { providers, signIn, signUp, resetPassword, resendVerification };
}
