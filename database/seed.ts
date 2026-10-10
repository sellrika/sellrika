// First-boot seed: the platform admin (ADMIN_EMAIL / ADMIN_PASSWORD) and one shop they own, when the tables are empty.
// The password is only read here: after the first boot it lives in the database and /settings changes it.
import { app } from "@config/app";
import { sql } from "@xcore/database/Database";
import { Container } from "@xcore/di";
import { PaymentMethodRepository } from "@repositories/PaymentMethod.Repository";

export async function seed() {
	const [{ n: users }] = await sql`select count(*) as n from users`;
	if (Number(users) === 0) {
		const email = process.env.ADMIN_EMAIL ?? "admin@sellrika.local";
		const password = process.env.ADMIN_PASSWORD ?? "password";
		await sql`insert into users (name, email, password_hash, email_verified_at) values ('Admin', ${email}, ${await Bun.password.hash(password)}, current_timestamp)`;
		console.log(`seeded admin user → ${email} / ${password}`);
	}
	const [{ n: shops }] = await sql`select count(*) as n from shops`;
	if (Number(shops) === 0) {
		const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
		// the platform admin owns it, else the oldest admin
		const [owner] = [
			...(await sql`select id from users where lower(email) = ${app.adminEmail}`),
			...(await sql`select id from users where role = 'admin' order by id limit 1`),
		];
		const [shop] =
			await sql`insert into shops (name, currency, timezone, slug, owner_id) values ('Main Shop', 'USD', ${tz}, 'main-shop', ${owner?.id ?? null}) returning id`;
		await Container.get(PaymentMethodRepository).seedDefaults(shop.id);
		console.log("seeded shop → Main Shop");
	}
}
if (import.meta.main) {
	await seed();
	await sql.close();
}
