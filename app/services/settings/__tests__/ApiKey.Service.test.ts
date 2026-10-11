import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
import {
	API_KEY_MAX,
	API_KEY_PREFIX,
	API_KEY_SEEN_EVERY_MS,
} from "@constants/Api.Constant";

// Temp SQLite DB (never the real one); db.ts reads DB_FILE at import.
process.env.DB_FILE = `${tmpdir()}/pos-apikey-test-${process.pid}.db`;
const { Db, sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { ApiKeyService: _ApiKeyService } = await import("../ApiKey.Service");
const ApiKeyService = Container.get(_ApiKeyService);
const { UserRepository: _UserRepository } = await import(
	"@repositories/User.Repository"
);
const UserRepository = Container.get(_UserRepository);
const { UserService: _UserService } = await import("../User.Service");
const UserService = Container.get(_UserService);

await migrate(true);

const tag = `${process.pid}-${Date.now()}`;
const owner = await UserRepository.create(
	{
		name: "Owner",
		email: `key-owner-${tag}@x.io`,
		role: "admin",
		password: "",
	},
	"x",
	null,
);
const [shop] = await Db.insert(
	sql,
	"shops",
	sql`insert into shops (name, currency, timezone, owner_id) values ('Keys', 'USD', 'UTC', ${owner.id})`,
	sql`id`,
);
const S = shop.id as number;

test("a key is shown once, stored as a hash, and speaks for its maker in its shop", async () => {
	const r = await ApiKeyService.create(S, owner, {
		name: "Sync",
		role: "admin",
	});
	if (r.errors) throw new Error("create failed");
	expect(r.token.startsWith(API_KEY_PREFIX)).toBe(true);
	expect(r.key.last4).toBe(r.token.slice(-4));
	// the key itself is nowhere in the database, and no listing carries the hash
	const [row] = await sql`select * from api_keys where id = ${r.key.id}`;
	expect(row.key_hash).not.toContain(r.token);
	expect(JSON.stringify(row)).not.toContain(r.token);
	const [listed] = await ApiKeyService.list(S);
	expect(listed).toMatchObject({ name: "Sync", created_by: "Owner" });
	expect("key_hash" in listed!).toBe(false);

	const caller = await ApiKeyService.authenticate(r.token);
	expect(caller?.shop.id).toBe(S);
	expect(caller?.user).toMatchObject({ id: owner.id, role: "admin" });

	// wrong keys: another key, no prefix, a good key with one character changed
	expect(await ApiKeyService.authenticate("nope")).toBeNull();
	expect(
		await ApiKeyService.authenticate(`${API_KEY_PREFIX}not-a-real-key`),
	).toBeNull();
	expect(await ApiKeyService.authenticate(`${r.token}x`)).toBeNull();

	// deleted = dead at once; another shop's id can not delete it
	await ApiKeyService.remove(r.key.id, S + 999);
	expect(await ApiKeyService.authenticate(r.token)).not.toBeNull();
	await ApiKeyService.remove(r.key.id, S);
	expect(await ApiKeyService.authenticate(r.token)).toBeNull();
});

test("a key never has more power than its role, or than its maker has today", async () => {
	const boss = await UserRepository.create(
		{
			name: "Boss",
			email: `key-boss-${tag}@x.io`,
			role: "admin",
			password: "",
		},
		"x",
		owner.id,
	);
	const low = await ApiKeyService.create(S, boss, {
		name: "Till",
		role: "cashier",
	});
	const high = await ApiKeyService.create(S, boss, {
		name: "All",
		role: "admin",
	});
	if (low.errors || high.errors) throw new Error("create failed");
	// the key's role caps an admin maker
	expect((await ApiKeyService.authenticate(low.token))?.user.role).toBe(
		"cashier",
	);
	expect((await ApiKeyService.authenticate(high.token))?.user.role).toBe(
		"admin",
	);

	// the maker is demoted: the admin key follows them down, the cashier key stays a cashier
	await sql`update users set role = 'manager' where id = ${boss.id}`;
	expect((await ApiKeyService.authenticate(high.token))?.user.role).toBe(
		"manager",
	);
	expect((await ApiKeyService.authenticate(low.token))?.user.role).toBe(
		"cashier",
	);

	// the maker is switched off: every key of theirs stops
	await sql`update users set active = ${false} where id = ${boss.id}`;
	expect(await ApiKeyService.authenticate(high.token)).toBeNull();
	await sql`update users set active = ${true} where id = ${boss.id}`;

	// the shop moves to another account: the key stops
	const other = await UserRepository.create(
		{
			name: "Other",
			email: `key-other-${tag}@x.io`,
			role: "admin",
			password: "",
		},
		"x",
		null,
	);
	await sql`update shops set owner_id = ${other.id} where id = ${S}`;
	expect(await ApiKeyService.authenticate(high.token)).toBeNull();
	await sql`update shops set owner_id = ${owner.id} where id = ${S}`;
	expect(await ApiKeyService.authenticate(high.token)).not.toBeNull();

	// the maker is deleted: their keys go with them
	expect(await UserService.remove(boss.id, owner)).toBeNull();
	expect(await ApiKeyService.authenticate(high.token)).toBeNull();
	const [{ n }] =
		await sql`select count(*) as n from api_keys where user_id = ${boss.id}`;
	expect(Number(n)).toBe(0);
});

test("last_used_at is written at most once a minute, and a shop has a key limit", async () => {
	const [s2] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, timezone, owner_id) values ('Keys 2', 'USD', 'UTC', ${owner.id})`,
		sql`id`,
	);
	const r = await ApiKeyService.create(s2.id, owner, {
		name: "First",
		role: "manager",
	});
	if (r.errors) throw new Error("create failed");
	// a string on SQLite, a Date on a database server: compare as text
	const used = async () => {
		const [row] =
			await sql`select last_used_at from api_keys where id = ${r.key.id}`;
		return row.last_used_at === null ? null : String(row.last_used_at);
	};
	expect(await used()).toBeNull();
	const t0 = Date.UTC(2026, 0, 1, 10, 0, 0);
	await ApiKeyService.authenticate(r.token, t0);
	const first = await used();
	expect(first).not.toBeNull();
	// a call 30 s later writes nothing; a call a minute later does
	await ApiKeyService.authenticate(r.token, t0 + 30_000);
	expect(await used()).toBe(first);
	await ApiKeyService.authenticate(r.token, t0 + API_KEY_SEEN_EVERY_MS);
	expect(await used()).not.toBe(first);

	for (let i = 1; i < API_KEY_MAX; i++) {
		const more = await ApiKeyService.create(s2.id, owner, {
			name: `K${i}`,
			role: "cashier",
		});
		expect(more.errors).toBeUndefined();
	}
	const over = await ApiKeyService.create(s2.id, owner, {
		name: "One too many",
		role: "cashier",
	});
	expect(over.errors?.name).toMatch(String(API_KEY_MAX));
});
