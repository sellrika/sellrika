export type { Role } from "@constants/User.Constant";
import type { Role } from "@constants/User.Constant";

/** A person who can sign in: an owner, or staff who work for one. */
export type User = {
	id: number;
	name: string;
	email: string;
	password_hash: string;
	role: Role;
	active: boolean;
	/**
	 * The owner this user works for.
	 * null = the user is an owner (migration 0052).
	 */
	owner_id: number | null;
	created_at: string;
	/**
	 * null = a self sign-up owner who has not opened
	 * the confirmation link (migration 0057).
	 */
	email_verified_at: string | null;
};
/** One signed-in browser of a user, keyed by the cookie value. */
export type Session = {
	id: string;
	user_id: number;
	shop_id: number | null;
	expires_at: string;
};
