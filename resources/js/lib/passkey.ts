/**
 * Passkeys in the browser.
 * The WebAuthn API works with bytes; the server speaks base64url.
 * These helpers ask the server for a challenge, ask the device, and hand back
 * the answer ready to post.
 */

/** What `POST /login/passkey` takes. */
export type PasskeyLogin = {
	id: string;
	client_data: string;
	authenticator_data: string;
	signature: string;
};

/** What `POST /settings/passkeys` takes, next to the name. */
export type PasskeyNew = {
	client_data: string;
	authenticator_data: string;
	public_key: string;
};

/** A credential as the server lists it in the options. */
type Listed = { type: "public-key"; id: string };

/**
 * Bytes to base64url.
 * @param buffer The bytes.
 * @returns The text, without padding.
 */
function encode(buffer: ArrayBuffer): string {
	let text = "";
	for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte);
	return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Base64url to bytes.
 * @param value The text from the server.
 * @returns The bytes.
 */
function decode(value: string): Uint8Array<ArrayBuffer> {
	const text = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
	const bytes = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
	return bytes;
}

/**
 * Turn a listed credential into the shape the browser wants.
 * @param c The credential from the server.
 * @returns The same, with its id as bytes.
 */
function descriptor(c: Listed): PublicKeyCredentialDescriptor {
	return { type: c.type, id: decode(c.id) };
}

/**
 * POST JSON to the app.
 * @param url The path.
 * @param data The body.
 * @returns The response.
 */
function post(url: string, data: unknown = {}) {
	return fetch(url, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify(data),
	});
}

/**
 * Whether this browser can use passkeys.
 * @returns False on the server and in old browsers.
 */
export function passkeysSupported(): boolean {
	return typeof window !== "undefined" && "PublicKeyCredential" in window;
}

/**
 * Ask the device to sign in with a passkey.
 * @returns The answer to post, or null when the person closed the dialog.
 */
export async function passkeyLogin(): Promise<PasskeyLogin | null> {
	const res = await post("/login/passkey/options");
	if (!res.ok) throw new Error(await res.text());
	const options = await res.json();
	let credential: Credential | null;
	try {
		credential = await navigator.credentials.get({
			publicKey: { ...options, challenge: decode(options.challenge) },
		});
	} catch {
		return null;
	}
	if (!credential) return null;
	const made = credential as PublicKeyCredential;
	const answer = made.response as AuthenticatorAssertionResponse;
	return {
		id: encode(made.rawId),
		client_data: encode(answer.clientDataJSON),
		authenticator_data: encode(answer.authenticatorData),
		signature: encode(answer.signature),
	};
}

/**
 * Ask the device to make a new passkey for the signed-in user.
 * @param password The user's current password; the server checks it first.
 * @returns The new passkey to post, the server's errors, `exists` when this
 * device already has one, or null when the person closed the dialog.
 */
export async function passkeyCreate(
	password: string,
): Promise<
	{ passkey: PasskeyNew } | { errors: Record<string, string> } | "exists" | null
> {
	const res = await post("/settings/passkeys/options", {
		current_password: password,
	});
	if (res.status === 422) return { errors: (await res.json()).errors };
	if (!res.ok) return { errors: { passkey: await res.text() } };
	const options = await res.json();
	let credential: Credential | null;
	try {
		credential = await navigator.credentials.create({
			publicKey: {
				...options,
				challenge: decode(options.challenge),
				user: { ...options.user, id: decode(options.user.id) },
				excludeCredentials: options.excludeCredentials.map(descriptor),
			},
		});
	} catch (e) {
		return (e as DOMException).name === "InvalidStateError" ? "exists" : null;
	}
	if (!credential) return null;
	const answer = (credential as PublicKeyCredential)
		.response as AuthenticatorAttestationResponse;
	const key = answer.getPublicKey();
	if (!key) return null;
	return {
		passkey: {
			client_data: encode(answer.clientDataJSON),
			authenticator_data: encode(answer.getAuthenticatorData()),
			public_key: encode(key),
		},
	};
}
