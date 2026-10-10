/**
 * Who a signed-in user is on the platform:
 * whose shops they work in, and whether they are the platform admin.
 * No imports beyond config, constants and types.
 * So the router, the views and the services can all use it.
 */
import { app } from "@config/app";
import type { User } from "@models/User";
import { ROLES, type Role } from "@constants/User.Constant";

/**
 * Who a signed-in user is on the platform.
 * Whose shops they work in, what their role may do,
 * and whether they are the platform admin.
 */
export class Account {
	/**
	 * The owner whose shops a user works in.
	 * An owner is their own account.
	 * A staff member belongs to their owner's.
	 * @param user The user.
	 * @returns The owner's user id.
	 */
	static id(user: Pick<User, "id" | "owner_id">): number {
		return user.owner_id ?? user.id;
	}

	/**
	 * Does this role have at least the power of `min`?
	 * `ROLES` is ordered from most power to least.
	 * @param role The user's role.
	 * @param min The least role that may do it.
	 * @returns True when `role` is `min` or above it.
	 */
	static atLeast(role: Role, min: Role): boolean {
		return ROLES.indexOf(role) <= ROLES.indexOf(min);
	}

	/**
	 * Is this the platform admin, the user named by `ADMIN_EMAIL`?
	 * Only they may change the platform settings: outgoing email,
	 * the address lists and extension code.
	 * They are an owner, never a staff member of someone's account.
	 * @param user The user.
	 * @returns True for the platform admin.
	 */
	static isPlatformAdmin(
		user: Pick<User, "email" | "role" | "owner_id">,
	): boolean {
		return (
			user.role === "admin" &&
			user.owner_id === null &&
			Account.isAdminEmail(user.email)
		);
	}

	/**
	 * Is this the `ADMIN_EMAIL` address?
	 * Nobody may take it: the platform admin is known by it.
	 * @param email An email address.
	 * @returns True when it is the platform admin's address, in any case.
	 */
	static isAdminEmail(email: string): boolean {
		return email.trim().toLowerCase() === app.adminEmail;
	}
}
