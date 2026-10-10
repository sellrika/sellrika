/** Session cookie settings — see `app/xcore/auth/Auth.ts`. */

/** Name of the session cookie (httpOnly, sameSite lax). */
export const SESSION_COOKIE = "sid";

/** How long a session stays valid, in days; also the cookie's max-age. */
export const SESSION_TTL_DAYS = 30;

/**
 * Name of the online store's customer session cookie.
 * httpOnly, sameSite lax.
 * A different cookie from the staff one.
 */
export const CUSTOMER_COOKIE = "csid";

/** How long an invitation link to a new shop owner works, in days. */
export const INVITE_TTL_DAYS = 7;

/**
 * How long a "forgot password" link works, in hours.
 * Short, because it opens the account.
 */
export const RESET_TTL_HOURS = 1;

/**
 * Minutes before the same account gets a second "forgot password" email.
 * Stops a script from filling somebody's inbox.
 */
export const RESET_WAIT_MINUTES = 2;

/**
 * `settings.key` of the self sign-up switch.
 * The value is JSON `true` or `false`; no row means off.
 */
export const SIGNUP_SETTING_KEY = "signup";

/**
 * How long a passkey challenge may be answered, in milliseconds.
 * Also the time the browser waits for the fingerprint.
 */
export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * Most challenges kept at once.
 * The oldest is dropped past it, so a script cannot fill the memory.
 */
export const PASSKEY_CHALLENGES_MAX = 10_000;

/** Most passkeys one user may keep. */
export const PASSKEY_MAX = 10;

/** Longest name a user may give a passkey. */
export const PASSKEY_NAME_MAX = 60;

/**
 * Longest base64url value a passkey request may carry.
 * A credential id is 1023 bytes at most; keys and signatures are smaller.
 */
export const PASSKEY_FIELD_MAX = 4096;

/**
 * The signature kinds the app asks a device for, by COSE number.
 * -7 = ES256 (phones, laptops, security keys), -257 = RS256 (Windows Hello).
 */
export const PASSKEY_ALGORITHMS = [-7, -257];

/** The site name a device shows next to a passkey. */
export const PASSKEY_RP_NAME = "Sellrika";

/**
 * Name of the cookie that remembers the page a guest wanted.
 * After the sign-in they are sent back to it (`Guard.comeBack`).
 */
export const NEXT_COOKIE = "next";

/**
 * Its name in production.
 * A `__Host-` cookie can only be set by the app's own host,
 * so a page on a store subdomain can not plant one.
 */
export const NEXT_COOKIE_PROD = "__Host-next";

/** How long that page is remembered, in seconds. */
export const NEXT_COOKIE_SECONDS = 10 * 60;

/** The longest path that is remembered. A cookie holds about 4000 characters. */
export const NEXT_PATH_MAX = 3000;
