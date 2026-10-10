import type { SQL } from "bun";

// When the user proved they own their email (self sign-up: they opened the confirmation link).
//   email_verified_at — null = not confirmed yet: the app shows only "Confirm your email".
// Every user so far counts as confirmed; so does anyone the app creates (seed, staff, invitations).
export async function up(db: SQL) {
	await db.unsafe(`alter table users add column email_verified_at timestamp`);
	await db.unsafe(`update users set email_verified_at = current_timestamp`);
}
