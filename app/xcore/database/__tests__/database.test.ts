import { expect, test } from "bun:test";

const { Db, sql } = await import("@xcore/database/Database");
const { MysqlDdl } = await import("@xcore/database/MysqlDdl");
const { migrate } = await import("@database/migrate");
await migrate(true);

test("MysqlDdl: a create table is rewritten for MySQL", () => {
	const out = MysqlDdl.rewrite(`create table things (
    id integer primary key auto_increment,
    key text primary key,
    email text not null unique,
    note text not null default '',
    zones text not null default '[{"name":"Everywhere"}]',
    shop_id integer not null references shops(id),
    change integer not null default 0,
    created_at timestamp not null default current_timestamp,
    primary key (a, b)
  )`);
	// a key needs a length; a reserved word needs backticks
	expect(out).toContain("`key` varchar(191) primary key");
	expect(out).toContain("email varchar(191) not null unique");
	// a default on text goes in brackets, and text is the big type
	expect(out).toContain("note longtext not null default ('')");
	expect(out).toContain(`default ('[{"name":"Everywhere"}]')`);
	expect(out).toContain("shop_id integer not null,");
	expect(out).toContain("`change` integer not null default 0");
	expect(out).toContain(
		"created_at datetime not null default current_timestamp",
	);
	expect(out).toContain("primary key (a, b)");
	expect(out).toEndWith("collate=utf8mb4_bin");
});

test("MysqlDdl: other statements only get their reserved words quoted", () => {
	expect(
		MysqlDdl.rewrite("alter table t add column body text not null default ''"),
	).toBe("alter table t add column body longtext not null default ('')");
	expect(MysqlDdl.rewrite("select key from settings")).toBe(
		"select `key` from settings",
	);
});

test("MysqlDdl: an index names its text columns with a length", () => {
	const parts = {
		unique: true,
		optional: false,
		name: "idx_x",
		table: "customers",
		columns: ["shop_id", "phone"],
	};
	expect(MysqlDdl.indexSql(parts, new Set(["phone"]))).toBe(
		"create unique index idx_x on customers (`shop_id`, `phone`(191))",
	);
});

test("Db.insert / update / delete: the row comes back on every database", async () => {
	const [shop] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency) values ('Db Test', 'USD')`,
	);
	expect(shop.name).toBe("Db Test");
	const where = sql`id = ${shop.id}`;
	// the same values again still count as a match (MySQL says "0 changed")
	for (const _ of [1, 2]) {
		const [row] = await Db.update(
			sql,
			"shops",
			sql`name = ${"Db Test 2"}`,
			where,
			sql`id, name`,
		);
		expect(row.name).toBe("Db Test 2");
	}
	expect(
		await Db.update(sql, "shops", sql`name = ${"x"}`, sql`id = ${-1}`),
	).toEqual([]);
	expect(await Db.delete(sql, "shops", where)).toBe(true);
	expect(await Db.delete(sql, "shops", where)).toBe(false);
});

test("Db.upsert / insertOnce: a row that is there is updated or left alone", async () => {
	const key = `db-test-${Date.now()}`;
	const value = async () =>
		(await sql`select value from settings where ${sql("key")} = ${key}`)[0]
			?.value;
	await Db.upsert(sql, "settings", { key, value: "a" }, ["key"], ["value"]);
	await Db.upsert(sql, "settings", { key, value: "b" }, ["key"], ["value"]);
	expect(await value()).toBe("b");
	await Db.upsert(sql, "settings", { key, value: "c" }, ["key"]);
	expect(await value()).toBe("b");
	await sql`delete from settings where ${sql("key")} = ${key}`;

	const row = { shop_id: 987654, email: `${key}@x.io` };
	const keys = ["shop_id", "email"];
	// email_unsubscribes has an id: the first call adds, the second finds it
	const id = await Db.insertOnce(sql, "email_unsubscribes", row, keys);
	expect(id).toBeGreaterThan(0);
	expect(await Db.insertOnce(sql, "email_unsubscribes", row, keys)).toBeNull();
	await sql`delete from email_unsubscribes where shop_id = ${row.shop_id}`;
});
