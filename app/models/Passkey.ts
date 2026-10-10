/** One passkey of a staff user (migration 0071). */
export type Passkey = {
	id: number;
	user_id: number;
	/** The passkey's own id from the device, base64url. */
	credential_id: string;
	/** The key that checks its signatures: SPKI DER as base64url. */
	public_key: string;
	/** What the user called it; '' = no name. */
	name: string;
	/** The device's use counter; 0 for passkeys that sync. */
	sign_count: number;
	last_used_at: string | null;
	created_at: string;
};

/** What the Settings page shows of a passkey: never the key itself. */
export type PasskeyInfo = Pick<
	Passkey,
	"id" | "name" | "last_used_at" | "created_at"
>;
