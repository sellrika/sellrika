import type { SQL } from "bun";

/**
 * The sign-in account a staff user signed up with,
 * when its provider did not prove the email (most Microsoft accounts).
 *   firebase_uid — the Firebase user id of that sign-in, null = none
 * One Firebase user signs in one staff user.
 * Same idea as `customers.firebase_uid` on the online store.
 */
export async function up(db: SQL) {
	await db.unsafe(`alter table users add column firebase_uid text`);
	await db.unsafe(
		`create unique index users_firebase_uid on users (firebase_uid)`,
	);
}
