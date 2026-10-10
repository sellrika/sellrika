import type { SQL } from "bun";

// Storefront content the admin edits on /online-store › Banner & contact: `banner` = one announcement line over
// the header; `phone`, `address`, `hours` + the social links (`facebook`/`instagram` = URLs, `viber`/`whatsapp` =
// phone digits) make the contact block in every template's footer. All optional (null = not shown).
export async function up(db: SQL) {
	for (const col of [
		"banner",
		"phone",
		"address",
		"hours",
		"facebook",
		"instagram",
		"viber",
		"whatsapp",
	])
		await db.unsafe(`alter table shops add column ${col} text`);
}
