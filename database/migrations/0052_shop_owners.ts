import type { SQL } from "bun";

// Shops get an owner, users get the owner they work for.
//   shops.owner_id — the user who owns the shop; they and their staff see it, nobody else
//   users.owner_id — the owner a staff member works for; null = the user is an owner
// Every shop and every other user that exists today goes to the platform admin (the
// ADMIN_EMAIL user), or to the oldest admin when that email is not in the table.
export async function up(db: SQL) {
	await db.unsafe(`alter table shops add column owner_id integer`);
	await db.unsafe(`alter table users add column owner_id integer`);
	const email = (
		process.env.ADMIN_EMAIL ?? "admin@sellrika.local"
	).toLowerCase();
	const [owner] = [
		...(await db`select id from users where lower(email) = ${email}`),
		...(await db`select id from users where role = 'admin' order by id limit 1`),
	];
	if (!owner) return; // an empty database: seed() creates the owner and the first shop
	await db`update users set role = 'admin', active = ${true}, owner_id = null where id = ${owner.id}`;
	await db`update users set owner_id = ${owner.id} where id <> ${owner.id}`;
	await db`update shops set owner_id = ${owner.id}`;
}
