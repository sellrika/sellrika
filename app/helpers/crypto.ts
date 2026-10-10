/**
 * AES-GCM has no synchronous Bun or WebCrypto equivalent.
 * `crypto.subtle` is async, and `encrypt` / `decrypt` are called
 * from synchronous settings loops.
 * So the ciphers stay on Bun's built-in `node:crypto`.
 * Hashing and randomness use `Bun.CryptoHasher` and the WebCrypto global.
 */
import { createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";

/**
 * The last derived key, with the `APP_KEY` it came from.
 * Hashing on every decrypt is wasted work: a page opens many secrets.
 */
let derived: { from: string; key: Buffer } | null = null;

/**
 * The key every secret is encrypted and signed with.
 * Secrets at rest (Stripe keys) are AES-256-GCM encrypted with a key
 * derived from the `APP_KEY` env var.
 * Losing or changing `APP_KEY` makes stored secrets unreadable:
 * re-enter them in the settings UI.
 * The key is worked out once per `APP_KEY` value.
 * @returns The 32-byte key.
 * @throws When `APP_KEY` is not set.
 */
function key() {
	const s = process.env.APP_KEY;
	if (!s)
		throw new Error(
			"Set the APP_KEY environment variable (any long random string) to store encrypted credentials",
		);
	if (derived?.from !== s)
		derived = {
			from: s,
			key: new Bun.CryptoHasher("sha256").update(s).digest(),
		};
	return derived.key;
}

/**
 * HMAC-SHA256 of a text with `APP_KEY`.
 * @param text What is signed.
 * @returns The signature, base64url.
 */
function sign(text: string) {
	return new Bun.CryptoHasher("sha256", key()).update(text).digest("base64url");
}

/**
 * SHA-256 of a text.
 * @param text The text.
 * @returns The hash, hex.
 */
export function sha256Hex(text: string) {
	return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/**
 * Encrypt a secret before it is stored.
 * @param plain The secret.
 * @returns "v1.<iv>.<tag>.<ciphertext>" (base64 parts).
 */
export function encrypt(plain: string) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const c = createCipheriv("aes-256-gcm", key(), iv);
	const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
	return [
		"v1",
		Buffer.from(iv).toString("base64"),
		c.getAuthTag().toString("base64"),
		data.toString("base64"),
	].join(".");
}

/**
 * Read a secret back that `encrypt` wrote.
 * @param box The stored value.
 * @returns The secret.
 * @throws When the value is not ours, or `APP_KEY` changed.
 */
export function decrypt(box: string) {
	const [v, iv, tag, data] = box.split(".");
	if (v !== "v1" || !iv || !tag || !data)
		throw new Error("Unrecognized encrypted value");
	const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
	d.setAuthTag(Buffer.from(tag, "base64"));
	return Buffer.concat([
		d.update(Buffer.from(data, "base64")),
		d.final(),
	]).toString("utf8");
}

/**
 * The signature of an unsubscribe link: HMAC-SHA256 of the shop id and email.
 * @param shopId The shop the email came from.
 * @param email The address, lower case.
 * @returns The signature, base64url.
 */
function unsubscribeSig(shopId: number, email: string) {
	return sign(`unsubscribe:${shopId}:${email}`);
}

/**
 * A signature an extension asks for (`sign()` in its route context).
 * It is HMAC-SHA256 with `APP_KEY`.
 * Bound to the extension and the shop,
 * so one extension or shop can't use another's.
 * No database row: the same value always gives the same signature.
 * @param extKey The extension key.
 * @param shopId The shop of the request.
 * @param value What is signed (a table name, an id…).
 * @returns The signature, base64url.
 */
export function extensionSignature(
	extKey: string,
	shopId: number,
	value: string,
) {
	return sign(`ext:${extKey}:${shopId}:${value}`);
}

/**
 * The TXT record value that proves a shop owns its custom domain.
 * No database row: the same shop and domain always give the same value.
 * @param shopId The shop.
 * @param domain The custom domain, lower case.
 * @returns `sellrika-verify=<HMAC-SHA256, base64url>`.
 */
export function domainToken(shopId: number, domain: string) {
	return `sellrika-verify=${sign(`domain:${shopId}:${domain}`)}`;
}

/**
 * The token of an unsubscribe link: the email plus its signature.
 * No database row per link; `readUnsubscribeToken` checks it.
 * @param shopId The shop the email comes from.
 * @param email The recipient.
 * @returns `<email, base64url>.<signature>`.
 */
export function unsubscribeToken(shopId: number, email: string) {
	const e = email.trim().toLowerCase();
	return `${Buffer.from(e).toString("base64url")}.${unsubscribeSig(shopId, e)}`;
}

/**
 * Read an unsubscribe token back.
 * @param shopId The shop of the page it was opened on.
 * @param token The token from the link.
 * @returns The email it was made for, or null when it is forged or broken.
 */
export function readUnsubscribeToken(shopId: number, token: string) {
	const [raw, sig] = token.split(".");
	if (!raw || !sig) return null;
	const email = Buffer.from(raw, "base64url").toString("utf8");
	const want = Buffer.from(unsubscribeSig(shopId, email));
	const got = Buffer.from(sig);
	return want.length === got.length && timingSafeEqual(want, got)
		? email
		: null;
}

/**
 * How many symbols a public order code has.
 * 12 symbols = 60 random bits.
 */
const REFERENCE_LENGTH = 12;
/**
 * The lengths a code may have.
 * Orders before the 12-symbol codes carry 16.
 * `normalizeReference` accepts both, so old confirmations still track.
 */
const REFERENCE_LENGTHS = new Set([REFERENCE_LENGTH, 16]);
/** The 32 symbols of a code: no look-alikes (I, O, 0, 1). */
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Put a dash after every four symbols.
 * @param s The symbols, like `XXXXXXXXXXXX`.
 * @returns `XXXX-XXXX-XXXX`.
 */
function grouped(s: string) {
	return s.match(/.{4}/g)!.join("-");
}

/**
 * A fresh public order code, `XXXX-XXXX-XXXX`.
 * It is what the buyer sees (emails, thank-you page, tracking)
 * instead of the sequential database id.
 * So an order can't be found by guessing the next number.
 * @returns e.g. "P8J4-MJSQ-4Z8T".
 */
export function orderReference() {
	const bytes = crypto.getRandomValues(new Uint8Array(REFERENCE_LENGTH));
	return grouped([...bytes].map((b) => REFERENCE_ALPHABET[b & 31]).join(""));
}

/**
 * What a buyer typed, as the stored form: upper-case, dashes in the middle.
 * @param input Anything typed into the "order code" box:
 *   "p8j4mjsq4z8t", " P8J4-MJSQ-4Z8T ", an older 16-symbol code, …
 * @returns The normalised code, or null when it can't be a code.
 */
export function normalizeReference(input: string) {
	const s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
	return REFERENCE_LENGTHS.has(s.length) &&
		[...s].every((c) => REFERENCE_ALPHABET.includes(c))
		? grouped(s)
		: null;
}

/**
 * What a search text may name an order by.
 * Staff type the order number (`12` or `#12`) or the public code.
 * @param q The search text.
 * @returns The order id (0 = not a number) and the code ("" = not a code).
 */
export function orderLookup(q: string): { id: number; code: string } {
	return {
		id: /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : 0,
		code: normalizeReference(q) ?? "",
	};
}

/**
 * The stored form of an API key: its SHA-256.
 * A key is 256 random bits, so a plain fast hash is enough.
 * A slow password hash would only make every API call slow.
 * @param key The key as the caller sent it.
 * @returns The hash, hex.
 */
export function apiKeyHash(key: string) {
	return sha256Hex(key);
}

/**
 * A fresh random id with no dashes: 32 hex symbols.
 * Used for our own checkout session keys and cart links.
 * @returns e.g. "3f2b8c1e9a7d4f60b1c2d3e4f5a6b7c8".
 */
export function randomId() {
	return crypto.randomUUID().replaceAll("-", "");
}

/**
 * A fresh random token for a URL or a header.
 * @param bytes How many random bytes.
 * @returns The bytes, base64url.
 */
export function randomToken(bytes: number) {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString(
		"base64url",
	);
}

/**
 * A text with its signature, for a value we hand out and read back later.
 * No database row: `readSigned` checks it.
 * @param kind What the value is for. One kind never passes as another.
 * @param text The text.
 * @returns `<text, base64url>.<signature>`.
 */
export function signed(kind: string, text: string) {
	return `${Buffer.from(text).toString("base64url")}.${sign(`${kind}:${text}`)}`;
}

/**
 * Read a value back that `signed` made.
 * @param kind What the value must be for.
 * @param token The value as it came back.
 * @returns The text, or null when it is forged, broken or of another kind.
 */
export function readSigned(kind: string, token: string) {
	const [raw, sig] = token.split(".");
	if (!raw || !sig) return null;
	const text = Buffer.from(raw, "base64url").toString("utf8");
	const want = Buffer.from(sign(`${kind}:${text}`));
	const got = Buffer.from(sig);
	return want.length === got.length && timingSafeEqual(want, got) ? text : null;
}

/**
 * The PKCE challenge of a verifier (method `S256`).
 * @param verifier The secret the client kept.
 * @returns Its SHA-256, base64url.
 */
export function pkceChallenge(verifier: string) {
	return new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");
}
