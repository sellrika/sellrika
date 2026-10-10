/**
 * Letters and digits a person can read out without mix-ups:
 * no 0/O, no 1/l/I.
 */
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * A random password from the browser's secure random source.
 * @param length How many characters (the server wants at least 8).
 * @returns The password.
 */
export function randomPassword(length = 8): string {
	// ponytail: bytes at or above the last full multiple of the alphabet are skipped, so every character is equally likely
	const limit = 256 - (256 % ALPHABET.length);
	let out = "";
	while (out.length < length) {
		for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
			if (byte < limit && out.length < length)
				out += ALPHABET[byte % ALPHABET.length];
		}
	}
	return out;
}
