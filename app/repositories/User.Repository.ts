import { Service } from "@xcore/di";
import { STORE_SYSTEM_EMAIL } from "@constants/Store.Constant";
import { Db, sql } from "@xcore/database/Database";
import { sqlStamp } from "@helpers/time";
import type { Role, User } from "@models/User";
import type { EditUserInput, NewUserInput } from "@validators/User.Validator";

/** A `users` row as the driver returns it: `active` is 0/1 on SQLite. */
type RawUser = Omit<User, "active"> & { active: unknown };

/** A Users page row as the driver returns it. */
type RawUserRow = Omit<UserRow, "active" | "activity"> & {
	active: unknown;
	activity?: unknown;
};

/**
 * A user as the Users page shows them, without the password hash.
 * `activity` = orders + refunds + stock movements + voids signed by this user.
 * Delete is only allowed at 0.
 */
export type UserRow = Omit<User, "password_hash" | "email_verified_at"> & {
	activity: number;
};

/** Users: owners, and the staff who work for an owner (`owner_id`). */
@Service()
export class UserRepository {
	/**
	 * One user, password hash included.
	 * @param id User id.
	 * @returns The user, or null.
	 */
	async find(id: number): Promise<User | null> {
		return Db.one(sql`select * from users where id = ${id}`, (r) =>
			this.#row(r),
		);
	}

	/**
	 * Look a user up by email (the login identifier).
	 * @param email Email address, matched exactly.
	 * @returns The user, or null.
	 */
	async findByEmail(email: string): Promise<User | null> {
		return Db.one(sql`select * from users where email = ${email}`, (r) =>
			this.#row(r),
		);
	}

	/**
	 * The user who signed up with a provider sign-in.
	 * @param uid The Firebase user id of the sign-in.
	 * @returns The user, or null.
	 */
	async findByFirebaseUid(uid: string): Promise<User | null> {
		return Db.one(sql`select * from users where firebase_uid = ${uid}`, (r) =>
			this.#row(r),
		);
	}

	/**
	 * Is a sign-in account tied to this user?
	 * @param id User id.
	 * @returns True when one is.
	 */
	hasFirebaseUid(id: number) {
		return Db.exists(
			sql`select 1 from users where id = ${id} and firebase_uid is not null`,
		);
	}

	/**
	 * Tie a provider sign-in to a user, or take it off.
	 * @param id User id.
	 * @param uid The Firebase user id of the sign-in, null = none.
	 */
	setFirebaseUid(id: number, uid: string | null) {
		return sql`update users set firebase_uid = ${uid} where id = ${id}`;
	}

	/**
	 * Everyone in one account: the owner and their staff, without password hashes.
	 * @param ownerId The owner.
	 * @returns Users with their `activity` count, oldest first.
	 */
	async all(ownerId: number): Promise<UserRow[]> {
		return (
			await sql`select u.id, u.name, u.email, u.role, u.active, u.owner_id, u.created_at,
        (select count(*) from orders o where o.user_id = u.id) + (select count(*) from orders o where o.voided_by = u.id)
        + (select count(*) from refunds r where r.user_id = u.id) + (select count(*) from stock_movements m where m.user_id = u.id) as activity
      from users u where u.id = ${ownerId} or u.owner_id = ${ownerId} order by u.created_at, u.id`
		).map((r: RawUserRow) => this.#pub(r));
	}

	/**
	 * Is this email already in use? Case does not matter.
	 * The online store's system address always counts as taken:
	 * the user that signs online orders is found by it,
	 * so nobody else may hold it, also before that user exists.
	 * @param email Email to check.
	 * @param exceptId User allowed to keep it (the one being edited).
	 * @returns True when taken.
	 */
	async emailTaken(email: string, exceptId = 0) {
		if (email.trim().toLowerCase() === STORE_SYSTEM_EMAIL) return true;
		return Db.exists(
			sql`select 1 from users where lower(email) = lower(${email}) and id <> ${exceptId}`,
		);
	}

	/**
	 * Create a staff account.
	 * @param d Validated name, email and role.
	 * @param passwordHash Already-hashed password.
	 * @param ownerId The owner they work for; null makes them an owner.
	 * @param verified False = the email still has to be confirmed (self sign-up).
	 * @returns The created user.
	 */
	async create(
		d: NewUserInput,
		passwordHash: string,
		ownerId: number | null,
		verified = true,
	): Promise<User> {
		const at = verified ? sqlStamp(new Date()) : null;
		return this.#row(
			(
				await sql`insert into users (name, email, password_hash, role, owner_id, email_verified_at) values (${d.name}, ${d.email}, ${passwordHash}, ${d.role}, ${ownerId}, ${at}) returning *`
			)[0],
		);
	}

	/**
	 * Mark the user's email as confirmed, now.
	 * @param id User id.
	 */
	verifyEmail(id: number) {
		return sql`update users set email_verified_at = current_timestamp where id = ${id}`;
	}

	/**
	 * Edit a staff account.
	 * @param id User id.
	 * @param d Validated name, email, role and active flag.
	 * @param passwordHash New hash, or null to keep the current password.
	 * @returns The updated user, or null when the id doesn't exist.
	 */
	async update(
		id: number,
		d: EditUserInput,
		passwordHash: string | null,
	): Promise<User | null> {
		const r = passwordHash
			? (
					await sql`update users set name = ${d.name}, email = ${d.email}, role = ${d.role}, active = ${d.active}, password_hash = ${passwordHash} where id = ${id} returning *`
				)[0]
			: (
					await sql`update users set name = ${d.name}, email = ${d.email}, role = ${d.role}, active = ${d.active} where id = ${id} returning *`
				)[0];
		return r ? this.#row(r) : null;
	}

	/**
	 * Delete a staff account (only ever called for users with no history).
	 * @param id User id.
	 */
	delete(id: number) {
		return sql`delete from users where id = ${id}`;
	}

	/**
	 * Rename a user from their own /settings page.
	 * @param id User id.
	 * @param name The new display name.
	 */
	updateName(id: number, name: string) {
		return sql`update users set name = ${name} where id = ${id}`;
	}

	/**
	 * Store a new password hash.
	 * @param id User id.
	 * @param hash Already-hashed password.
	 */
	updatePassword(id: number, hash: string) {
		return sql`update users set password_hash = ${hash} where id = ${id}`;
	}

	/**
	 * Owners by email (an owner = `owner_id` null).
	 * @param emails Emails, lower case.
	 * @returns email → user id, for the ones that are owners.
	 */
	async ownerIdsByEmail(emails: string[]): Promise<Map<string, number>> {
		if (!emails.length) return new Map();
		const rows: { id: number; email: string }[] =
			await sql`select id, email from users where owner_id is null and email in ${sql(emails)}`;
		return new Map(rows.map((r) => [r.email, Number(r.id)]));
	}

	/**
	 * The emails of some users.
	 * @param ids User ids.
	 * @returns id → email.
	 */
	async emailsById(ids: number[]): Promise<Map<number, string>> {
		if (!ids.length) return new Map();
		const rows: { id: number; email: string }[] =
			await sql`select id, email from users where id in ${sql(ids)}`;
		return new Map(rows.map((r) => [Number(r.id), r.email]));
	}
	/**
	 * Turn a database row into a `User`, password hash included.
	 * SQLite returns booleans as 0/1.
	 * @param r The raw row.
	 * @returns The row with a real boolean.
	 */
	#row(r: RawUser): User {
		// the sign-in account stays in the repository: a `User` travels far
		const { firebase_uid: _, ...user } = r as RawUser & {
			firebase_uid?: string | null;
		};
		return {
			...user,
			active: !!r.active,
		};
	}

	/**
	 * Turn a database row into a `UserRow`.
	 * Only the listed fields are kept, so the password hash never leaves.
	 * @param r The raw row.
	 * @returns The public row.
	 */
	#pub(r: RawUserRow): UserRow {
		return {
			id: r.id,
			owner_id: r.owner_id ?? null,
			name: r.name,
			email: r.email,
			role: r.role,
			active: !!r.active,
			created_at: r.created_at,
			activity: Number(r.activity ?? 0),
		};
	}
}
export type { Role };
