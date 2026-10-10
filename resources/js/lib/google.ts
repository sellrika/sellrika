/**
 * "Continue with Google" and "Continue with Microsoft"
 * on the staff sign-in page.
 * The pop-up is opened by the Firebase JS SDK (compat build),
 * loaded on the first click only.
 * The server checks the token it hands back (`POST /login/<provider>`).
 */

import { t } from "@/lib/i18n";

/** The sign-in buttons Firebase runs for us. */
export type SignInProvider = "google" | "microsoft";

/**
 * The Firebase JS SDK files.
 * Mirror of FIREBASE_SDK_VERSION in app/constants/Store.Constant.ts.
 */
const SDK = "https://www.gstatic.com/firebasejs/10.14.1";

/** The platform's Firebase web config, as the login page gets it. */
export type GoogleConfig = {
	apiKey: string;
	authDomain: string;
	projectId: string;
	appId: string;
};

/** The slice of the `firebase` global this file touches. */
type FirebaseGlobal = {
	apps: unknown[];
	initializeApp(cfg: GoogleConfig): void;
	auth: (() => {
		signInWithPopup(p: unknown): Promise<{
			user: {
				getIdToken(): Promise<string>;
				displayName?: string | null;
				email?: string | null;
			};
		}>;
	}) & {
		GoogleAuthProvider: new () => unknown;
		OAuthProvider: new (id: string) => unknown;
	};
};

/** Who signed in, and the token that proves it to the server. */
export type SignedIn = {
	via: SignInProvider;
	token: string;
	name: string;
	email: string;
};

/** Where the sign-in page leaves a new person for the sign-up page. */
const HANDOFF_KEY = "signup-provider";

/**
 * Keep who signed in, for the sign-up page that opens next.
 * In this tab only, and read once.
 * @param who The person, with their token.
 */
export function keepForSignup(who: SignedIn) {
	try {
		sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(who));
	} catch {
		// no storage: the sign-up page starts at step 1
	}
}

/**
 * Read who the sign-in page left, and forget it.
 * @returns The person, or null.
 */
export function takeForSignup(): SignedIn | null {
	try {
		const text = sessionStorage.getItem(HANDOFF_KEY);
		sessionStorage.removeItem(HANDOFF_KEY);
		return text ? (JSON.parse(text) as SignedIn) : null;
	} catch {
		return null;
	}
}

/** Firebase's codes for "the person closed the pop-up". */
const CLOSED = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"];

/**
 * Load one outside script.
 * @param src The script's address.
 * @returns Resolves when it ran.
 */
function loadScript(src: string) {
	return new Promise<void>(function run(ok, fail) {
		const el = document.createElement("script");
		el.src = src;
		el.onload = function loaded() {
			ok();
		};
		el.onerror = function failed() {
			fail(new Error(`Could not load ${src}`));
		};
		document.head.appendChild(el);
	});
}

/**
 * Open the sign-in pop-up of Google or Microsoft.
 * @param config The platform's Firebase web config.
 * @param via Whose pop-up to open.
 * @returns Who signed in with their Firebase ID token,
 *   or null when the pop-up was closed.
 * @throws When the SDK does not load or Google refuses.
 */
export async function providerSignIn(
	config: GoogleConfig,
	via: SignInProvider,
): Promise<SignedIn | null> {
	const w = window as unknown as { firebase?: FirebaseGlobal };
	if (!w.firebase) {
		await loadScript(`${SDK}/firebase-app-compat.js`);
		await loadScript(`${SDK}/firebase-auth-compat.js`);
	}
	const fb = w.firebase;
	if (!fb) throw new Error("Could not load the sign-in");
	if (!fb.apps.length) fb.initializeApp(config);
	try {
		const provider =
			via === "microsoft"
				? new fb.auth.OAuthProvider("microsoft.com")
				: new fb.auth.GoogleAuthProvider();
		const { user } = await fb.auth().signInWithPopup(provider);
		return {
			via,
			token: await user.getIdToken(),
			name: user.displayName ?? "",
			email: user.email ?? "",
		};
	} catch (e) {
		const code = (e as { code?: string }).code ?? "";
		if (CLOSED.includes(code)) return null;
		// one Firebase user per email: the other provider got there first
		if (code === "auth/account-exists-with-different-credential")
			throw new Error(t("nav.login_other_way"));
		throw e;
	}
}
