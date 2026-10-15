/**
 * Abuse limits and hard input bounds.
 * Every number a security review would ask about lives here.
 */
import type { Key } from "@i18n";

/**
 * Rate-limit buckets.
 * `limit` requests per `windowMs` per client IP, per bucket name.
 * `message` is a dictionary key.
 * `RateLimit.middleware()` translates it into the caller's language.
 * Tuned to be invisible to a busy shop and painful to a script.
 */
export const RATE_LIMITS = {
	/**
	 * Invitation links.
	 * A real person opens one once or twice.
	 * A script would guess tokens.
	 */
	invite: {
		limit: 20,
		windowMs: 15 * 60_000,
		message: "server.rate_attempts",
	},
	/**
	 * "Forgot password": each one may send an email.
	 * A real person needs it once or twice.
	 */
	passwordForgot: {
		limit: 5,
		windowMs: 15 * 60_000,
		message: "server.rate_attempts",
	},
	/**
	 * "Forgot password" links.
	 * A real person opens one once or twice.
	 * A script would guess tokens.
	 */
	passwordReset: {
		limit: 20,
		windowMs: 15 * 60_000,
		message: "server.rate_attempts",
	},
	/**
	 * "Resend the confirmation email": each one sends an email.
	 * A real person needs it once or twice.
	 */
	confirmResend: {
		limit: 5,
		windowMs: 15 * 60_000,
		message: "server.rate_attempts",
	},
	/**
	 * Self sign-up (`/register`, page and form).
	 * Each sign-up hashes a password and creates an account and a shop.
	 * A real person signs up once; a script would make hundreds.
	 */
	signup: {
		limit: 20,
		windowMs: 15 * 60_000,
		message: "server.rate_attempts",
	},
	/**
	 * *Failed* sign-ins (a success costs nothing).
	 * The argon2 verify is the expensive part.
	 * So this is both anti-brute-force and anti-CPU-DoS.
	 */
	login: {
		limit: 10,
		windowMs: 15 * 60_000,
		message: "server.rate_login",
	},
	/**
	 * Passkey challenges, and adding a passkey
	 * (an argon2 verify of the password).
	 * A real person asks a few times.
	 * A script would fill the challenge list.
	 */
	passkey: {
		limit: 30,
		windowMs: 10 * 60_000,
		message: "server.rate_attempts",
	},
	/**
	 * Public checkout.
	 * It prices a whole cart from the DB and talks to the payment provider.
	 */
	storeCheckout: {
		limit: 20,
		windowMs: 10 * 60_000,
		message: "server.rate_checkout",
	},
	/**
	 * Unpaid online orders (cash on delivery, bank transfer).
	 * Each one takes stock and emails the buyer with no payment at all.
	 * So far fewer are allowed than paid checkouts.
	 * Taken in `StoreController.checkout`,
	 * only when a manual option is picked.
	 */
	storeManualOrder: {
		limit: 5,
		windowMs: 60 * 60_000,
		message: "server.rate_checkout",
	},
	/** Charging a nonce — one real buyer needs one or two of these. */
	storePay: {
		limit: 20,
		windowMs: 10 * 60_000,
		message: "server.rate_pay",
	},
	/**
	 * Public coupon checks.
	 * A real buyer tries one or two codes.
	 * A script would try thousands.
	 */
	storeCoupon: {
		limit: 30,
		windowMs: 10 * 60_000,
		message: "server.rate_attempts",
	},
	/**
	 * Public address lookups at the checkout
	 * (states, then a state's cities).
	 * A buyer makes a few.
	 * It is not a bulk export of the list.
	 */
	storeAddress: {
		limit: 120,
		windowMs: 60_000,
		message: "server.rate_requests",
	},
	/**
	 * Public "track my order" lookups.
	 * They take the order number + the buyer's email/phone.
	 * So this is the guard against guessing.
	 */
	/**
	 * The "thank you" page: each hit asks the payment provider.
	 * The page asks again every 4 seconds while a payment is pending,
	 * so this leaves room for two open tabs and no more.
	 */
	storeDone: {
		limit: 40,
		windowMs: 60_000,
		message: "server.rate_checkout",
	},
	storeTrack: {
		limit: 30,
		windowMs: 10 * 60_000,
		message: "server.rate_track",
	},
	/**
	 * "Send test to me" on a campaign: each one sends an email.
	 * An owner checks a draft a few times, not hundreds.
	 */
	marketingTest: {
		limit: 10,
		windowMs: 10 * 60_000,
		message: "server.rate_attempts",
	},
	/**
	 * The unsubscribe button of the store.
	 * A person clicks it once; a script would try tokens.
	 */
	storeUnsubscribe: {
		limit: 20,
		windowMs: 10 * 60_000,
		message: "server.rate_attempts",
	},
	/**
	 * Public routes an extension adds to the storefront
	 * (`/store/:slug/ext/:key/*`).
	 * Whatever they do, they can't be hammered.
	 */
	storeExtension: {
		limit: 120,
		windowMs: 60_000,
		message: "server.rate_requests",
	},
	/**
	 * The pages an extension brings to a store (`GET /*`, the last route),
	 * like a blog's posts. Also every address nothing answers.
	 * Its own budget: a reader, or a search engine reading post after
	 * post, never uses up the one of the extensions' own routes.
	 */
	storePage: {
		limit: 300,
		windowMs: 60_000,
		message: "server.rate_requests",
	},
	/**
	 * Customer sign-ins on the store.
	 * Each one asks Firebase to verify the token.
	 * A real buyer signs in once.
	 */
	storeLogin: {
		limit: 20,
		windowMs: 10 * 60_000,
		message: "server.rate_login",
	},
	/**
	 * Image uploads (admin).
	 * 5 MB each, so this caps disk growth per client too.
	 */
	upload: {
		limit: 60,
		windowMs: 10 * 60_000,
		message: "server.rate_upload",
	},
	/**
	 * "Send a test email".
	 * The one endpoint that makes the server mail an arbitrary address.
	 */
	mailTest: {
		limit: 5,
		windowMs: 60 * 60_000,
		message: "server.rate_mail_test",
	},
	/**
	 * Type-ahead lookups.
	 * Generous, but not a free scraping API for the customer list.
	 */
	search: {
		limit: 120,
		windowMs: 60_000,
		message: "server.rate_search",
	},
	/**
	 * API calls (`/api/v1`), counted per key and not per IP.
	 * Enough for a sync job that walks a whole catalogue.
	 * A loop gone wrong is stopped.
	 */
	api: {
		limit: 600,
		windowMs: 60_000,
		message: "server.rate_requests",
	},
	/**
	 * API calls with a missing or wrong key, per IP (a good call costs nothing).
	 * Each one is a database lookup, and a script would try keys.
	 */
	apiAuth: {
		limit: 30,
		windowMs: 10 * 60_000,
		message: "server.rate_attempts",
	},
	/**
	 * The public OAuth endpoints of the MCP server, per IP.
	 * An assistant's own servers call them for all of its users,
	 * so the limit is wide. It only stops a flood.
	 */
	oauth: {
		limit: 600,
		windowMs: 10 * 60_000,
		message: "server.rate_requests",
	},
} as const satisfies Record<
	string,
	{ limit: number; windowMs: number; message: Key }
>;

/**
 * Largest request body Bun will read at all.
 * Above the 5 MB image cap and the 2 MB CSV cap.
 * Far below what a JSON bomb needs to hurt.
 */
export const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;

/**
 * Hard bounds on list inputs. This one: the lines of one cart.
 * Each cart line costs a DB round trip.
 * So an unbounded array is a DoS.
 */
export const MAX_CART_ITEMS = 100;

/** Hard bound on the lines of one refund. */
export const MAX_REFUND_ITEMS = 200;

/**
 * The most entries in a coupon's product/category scope.
 * The scope is checked against every cart line.
 */
export const MAX_COUPON_SCOPE = 200;

/**
 * The most emails in a coupon's customer list.
 * The list is checked against every cart line.
 */
export const MAX_COUPON_EMAILS = 500;

/**
 * The most of one item on a line.
 * No real sale is bigger than this.
 * It keeps `price * qty` far away from the float-precision cliff.
 */
export const MAX_LINE_QTY = 10_000;

/**
 * Ceiling on the "amount paid" a till can enter, in cents.
 * 10 million currency units.
 */
export const MAX_PAID_CENTS = 1_000_000_000;

/**
 * Response headers set on every route.
 * - No CSP `script-src`: the root view carries an inline theme script
 *   and an inline page-JSON block,
 *   and Vite injects its own scripts in dev.
 *   ponytail: add a nonce in `inertia.ts` + `app.edge`
 *   and tighten to `script-src 'self' 'nonce-…'`
 *   when someone wants belt and braces.
 * - `frame-ancestors 'none'` is the clickjacking guard that matters here
 *   (the POS takes money).
 */
export const SECURITY_HEADERS: Record<string, string> = {
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"X-Frame-Options": "DENY",
	"Content-Security-Policy":
		"frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
	/**
	 * `same-origin-allow-popups`, not `same-origin`.
	 * The store's Google / Microsoft sign-in pop-up
	 * (Firebase `signInWithPopup`) must be able to report back
	 * to the page that opened it.
	 * Else Firebase throws `auth/popup-closed-by-user`.
	 */
	"Cross-Origin-Opener-Policy": "same-origin-allow-popups",
};

/** Sent only over HTTPS in production: two years, subdomains included. */
export const HSTS_HEADER = "max-age=63072000; includeSubDomains";

/**
 * Paths that take a change from a page of another host.
 * Every other path refuses it (`Url.foreign`).
 * `/api` uses a Bearer key and answers the docs host (CORS).
 * `/mcp` uses a key header.
 * `/oauth/token` and `/oauth/register` are called by an MCP client:
 * the first needs a one-time code and its PKCE secret, the second stores nothing.
 * `/oauth/authorize` is not here: it acts for the signed-in admin.
 * `/done` is where a payment provider sends the buyer back (a form POST).
 * `/unsubscribe` is the one-click POST of a mail app.
 */
export const ORIGIN_FREE_PATHS = [
	"/api",
	"/mcp",
	"/oauth/token",
	"/oauth/register",
	"/done",
	"/unsubscribe",
];

/**
 * Fields only managers and admins may read:
 * what the shop pays for a product, and what a sold line cost.
 * A cashier's answer carries them as null (`app/helpers/costs.ts`).
 */
export const MANAGER_ONLY_FIELDS: readonly string[] = [
	"purchase_price",
	"cost",
];
