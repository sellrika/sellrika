import { decrypt } from "@helpers/crypto";

/**
 * One setting a person fills in, e.g. an API key or a bank account.
 * A `secret` one is stored encrypted and is never sent back to a page.
 * `required` left out means the field must be filled.
 */
export type SecretField = {
	name: string;
	secret: boolean;
	required?: boolean;
};

/**
 * The stored fields of one provider, ready to use.
 * Secrets are decrypted.
 * @param fields The provider's field list.
 * @param stored What the database holds for this provider.
 * @returns The plain values, or null while a required field is empty.
 * @throws When `APP_KEY` no longer decrypts a stored secret.
 */
export function openFields(
	fields: readonly SecretField[],
	stored: Record<string, string>,
): Record<string, string> | null {
	const out: Record<string, string> = {};
	for (const f of fields) {
		const v = stored[f.name] ?? "";
		if ((f.required ?? true) && !v) return null;
		out[f.name] = f.secret && v ? decrypt(v) : v;
	}
	return out;
}

/**
 * The stored fields of one provider, safe to send to a settings page.
 * A secret comes back empty. `secret_set` only says if one is stored.
 * @param fields The provider's field list.
 * @param stored What the database holds for this provider.
 * @returns The values to show and the `secret_set` map.
 */
export function maskFields(
	fields: readonly SecretField[],
	stored: Record<string, string>,
) {
	const credentials: Record<string, string> = {};
	const secret_set: Record<string, boolean> = {};
	for (const f of fields) {
		credentials[f.name] = f.secret ? "" : (stored[f.name] ?? "");
		if (f.secret) secret_set[f.name] = !!stored[f.name];
	}
	return { credentials, secret_set };
}
