import type { Role } from "@constants/User.Constant";

/**
 * An API key of one shop (`api_keys`, migration 0073).
 * The key itself is never stored.
 */
export type ApiKey = {
	id: number;
	shop_id: number;
	/** The admin who made it; the key acts as them. */
	user_id: number;
	name: string;
	/** The most the key may do. */
	role: Role;
	/** The key's last 4 characters. */
	last4: string;
	/** null = never used. */
	last_used_at: string | null;
	created_at: string;
};
/** A row of the API keys page: the key with the name of who made it. */
export type ApiKeyRow = ApiKey & { created_by: string | null };
