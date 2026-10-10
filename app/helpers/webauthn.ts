/**
 * The WebAuthn checks behind passkeys.
 * Every value comes in as base64url, the way the browser sends it.
 * No attestation: the app accepts any device.
 * So there is nothing to parse but fixed offsets.
 */

/**
 * `node:crypto`, not WebCrypto.
 * A passkey signs in DER, and WebCrypto only checks raw ECDSA signatures.
 */
import { createPublicKey, verify } from "node:crypto";

/** The person touched the device. */
const FLAG_PRESENT = 0x01;

/** The device checked who it is: fingerprint, face or PIN. */
const FLAG_VERIFIED = 0x04;

/** The data carries a new credential (only when a passkey is made). */
const FLAG_CREDENTIAL = 0x40;

/** Key types the app asks for: ES256 and RS256. */
const KEY_TYPES = ["ec", "rsa"];

/**
 * Decode a base64url value.
 * @param value The text from the browser.
 * @returns The bytes.
 */
function decode(value: string) {
	return Buffer.from(value, "base64url");
}

/**
 * SHA-256 of some bytes.
 * @param data The bytes, or text.
 * @returns The 32-byte hash.
 */
function sha256(data: Buffer | string) {
	return new Bun.CryptoHasher("sha256").update(data).digest();
}

/**
 * Load a stored public key.
 * @param publicKey SPKI DER as base64url.
 * @returns The key, or null when it is broken or of another type.
 */
function keyOf(publicKey: string) {
	try {
		const key = createPublicKey({
			key: decode(publicKey),
			format: "der",
			type: "spki",
		});
		return KEY_TYPES.includes(key.asymmetricKeyType ?? "") ? key : null;
	} catch {
		return null;
	}
}

/**
 * Read what the browser says it signed.
 * It must be the right kind of answer and come from our own page.
 * @param clientData The browser's `clientDataJSON`.
 * @param type `webauthn.create` for a new passkey,
 * `webauthn.get` for a sign-in.
 * @param origin The app's origin, like `https://sellrika.com`.
 * @returns The challenge inside it, or null when the answer is not ours.
 */
export function readClientData(
	clientData: string,
	type: "webauthn.create" | "webauthn.get",
	origin: string,
): string | null {
	try {
		const data = JSON.parse(decode(clientData).toString("utf8"));
		if (data.type !== type || data.origin !== origin) return null;
		if (data.crossOrigin === true) return null;
		return typeof data.challenge === "string" ? data.challenge : null;
	} catch {
		return null;
	}
}

/**
 * Read the device's part of the answer.
 * It must be made for our site, by a person the device has checked.
 * @param authenticatorData The device's `authenticatorData`.
 * @param rpId The site the passkey belongs to: the app's hostname.
 * @returns The use counter and, for a new passkey, its id. Null when refused.
 */
export function readAuthenticatorData(
	authenticatorData: string,
	rpId: string,
): { signCount: number; credentialId: string | null } | null {
	const data = decode(authenticatorData);
	if (data.length < 37) return null;
	if (!data.subarray(0, 32).equals(sha256(rpId))) return null;
	const flags = data[32]!;
	if (!(flags & FLAG_PRESENT) || !(flags & FLAG_VERIFIED)) return null;
	const signCount = data.readUInt32BE(33);
	if (!(flags & FLAG_CREDENTIAL)) return { signCount, credentialId: null };
	// 16 bytes of device model, then the id's length, then the id
	if (data.length < 55) return null;
	const length = data.readUInt16BE(53);
	if (length === 0 || data.length < 55 + length) return null;
	const credentialId = data.subarray(55, 55 + length).toString("base64url");
	return { signCount, credentialId };
}

/**
 * Whether a new passkey's public key is one the app can check later.
 * @param publicKey SPKI DER as base64url.
 * @returns True for an EC or RSA key.
 */
export function validPublicKey(publicKey: string): boolean {
	return keyOf(publicKey) !== null;
}

/**
 * Check a sign-in signature.
 * The device signs its own data plus the hash of what the browser saw.
 * @param publicKey The stored key of the passkey.
 * @param authenticatorData The device's `authenticatorData`.
 * @param clientData The browser's `clientDataJSON`.
 * @param signature The signature.
 * @returns True when the passkey made this signature.
 */
export function verifySignature(
	publicKey: string,
	authenticatorData: string,
	clientData: string,
	signature: string,
): boolean {
	const key = keyOf(publicKey);
	if (!key) return false;
	try {
		const signed = Buffer.concat([
			decode(authenticatorData),
			sha256(decode(clientData)),
		]);
		return verify("sha256", signed, key, decode(signature));
	} catch {
		return false;
	}
}
