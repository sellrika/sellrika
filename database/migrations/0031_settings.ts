import type { SQL } from "bun";

// App-level (account) settings as a tiny key/value store — one row per concern, JSON in `value`.
// Today: key 'mail' = { driver, from_name, from_email, credentials: { [driver]: { field: value } } },
// with secret fields individually encrypted (app/xcore/crypto.ts). See app/services/MailService.ts.
export async function up(db: SQL) {
	await db.unsafe(`create table settings (
    key text primary key,
    value text not null
  )`);
}
