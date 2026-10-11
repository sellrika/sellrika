import { mkdirSync } from "node:fs"; // Bun has no sync mkdir
import { dirname } from "node:path";
import { SQL } from "bun";
import { database } from "@config/database";

/** The database in use: `sqlite`, `postgres` or `mysql`. */
export const dialect = database.default;
/** The connection settings of that database. */
const conn = database.connections[dialect];

/**
 * SQLite makes the file, but not the folder it is in.
 * A fresh clone has no such folder, so make it first.
 */
if (dialect === "sqlite")
	mkdirSync(dirname(conn.url.replace("sqlite://", "")), { recursive: true });

/** The one database connection. Queries are written with this tag. */
export const sql = new SQL(conn.url, conn.options);

/** Portable auto-increment primary key DDL. */
export const ID_PK = {
	sqlite: "integer primary key autoincrement",
	postgres: "integer primary key generated always as identity",
	mysql: "integer primary key auto_increment",
}[dialect];

/** MySQL has no `returning` and no `on conflict`. `Db` hides that. */
const mysql = dialect === "mysql";

/**
 * A piece of SQL made with the `sql` tag.
 * It can be run, or put inside another query.
 */
export type Fragment = SQL.Query<unknown>;

/**
 * Small helpers for queries written with the `sql` tag.
 */
export class Db {
	/**
	 * The first row of a query, or null when it found nothing.
	 * @param query The query to run.
	 * @param map Turns the raw row into its model. Left out = the row as it is.
	 * @returns The row, or null.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: a raw driver row has no type
	static async one<T = any>(
		// biome-ignore lint/suspicious/noExplicitAny: a raw driver row has no type
		query: PromiseLike<any[]>,
		// biome-ignore lint/suspicious/noExplicitAny: a raw driver row has no type
		map?: (row: any) => T,
	): Promise<T | null> {
		const row = (await query)[0];
		if (!row) return null;
		return map ? map(row) : row;
	}

	/**
	 * Did the query find or change at least one row?
	 * Use it with `select 1 …`. For a write, use `Db.update` or `Db.delete`.
	 * @param query The query to run.
	 * @returns True when a row came back.
	 */
	static async exists(query: PromiseLike<unknown[]>): Promise<boolean> {
		return (await query).length > 0;
	}

	/**
	 * The start of an ORDER BY that puts empty values last.
	 * SQLite and Postgres disagree on where nulls go, so it is said out loud.
	 * @param value The column or expression to sort by. Fixed SQL only.
	 * @param dir The direction.
	 * @returns A fragment ending in a comma.
	 */
	static nullsLast(value: Fragment, dir: "asc" | "desc"): Fragment {
		return dir === "asc"
			? sql`(${value}) is null, ${value} asc,`
			: sql`(${value}) is null, ${value} desc,`;
	}

	/**
	 * Insert one row and read it back: `insert … returning` for every database.
	 * The table must have an auto-increment `id`.
	 * @param db The connection or transaction.
	 * @param table The table.
	 * @param query The whole `insert into … values (…)`, with no `returning`.
	 * @param cols The columns to read back. Left out = all.
	 * @returns The new row, in a list like a query gives.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: a raw driver row has no type
	static async insert<T = any>(
		db: SQL,
		table: string,
		query: Fragment,
		cols: Fragment = sql`*`,
	): Promise<T[]> {
		if (!mysql) return db`${query} returning ${cols}`;
		// biome-ignore lint/suspicious/noExplicitAny: the driver's result has no type
		const id = ((await query) as any).lastInsertRowid;
		return db`select ${cols} from ${db(table)} where id = ${id}`;
	}

	/**
	 * Update one row and read it back: `update … returning` for every database.
	 * The table must have an `id`, and `where` must match one row at most.
	 * @param db The connection or transaction.
	 * @param table The table.
	 * @param set The assignments, e.g. sql`name = ${name}`.
	 *   MySQL runs them left to right and sees the new values.
	 *   So read a column before the assignment that changes it.
	 * @param where The condition, e.g. sql`id = ${id}`.
	 * @param cols The columns to read back. Left out = `id`.
	 * @returns The row after the update, in a list. Empty when none matched.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: a raw driver row has no type
	static async update<T = any>(
		db: SQL,
		table: string,
		set: Fragment,
		where: Fragment,
		cols: Fragment = sql`id`,
	): Promise<T[]> {
		if (!mysql)
			return db`update ${db(table)} set ${set} where ${where} returning ${cols}`;
		/**
		 * MySQL counts only the rows whose values changed.
		 * `last_insert_id(id)` names the matched row, changed or not.
		 */
		const done =
			await db`update ${db(table)} set id = last_insert_id(id), ${set} where ${where}`;
		const id = done.lastInsertRowid;
		if (!id) return [];
		return db`select ${cols} from ${db(table)} where id = ${id}`;
	}

	/**
	 * Delete rows and say if any was there.
	 * @param db The connection or transaction.
	 * @param table The table.
	 * @param where The condition, e.g. sql`id = ${id}`.
	 * @returns True when at least one row was deleted.
	 */
	static async delete(db: SQL, table: string, where: Fragment) {
		if (!mysql)
			return Db.exists(db`delete from ${db(table)} where ${where} returning 1`);
		return (await db`delete from ${db(table)} where ${where}`).affectedRows > 0;
	}

	/**
	 * Insert rows. A row that is there already is updated, or left alone.
	 * @param db The connection or transaction.
	 * @param table The table.
	 * @param rows One row or many, as objects of column → value.
	 * @param keys The columns of the unique index that says "already there".
	 * @param update The columns that take the new value. Empty = leave the old row alone.
	 * @returns The driver's result.
	 */
	static upsert(
		db: SQL,
		table: string,
		rows: Record<string, unknown> | Record<string, unknown>[],
		keys: string[],
		update: string[] = [],
	) {
		const list = (parts: Fragment[]) => parts.reduce((a, b) => db`${a}, ${b}`);
		if (!mysql) {
			const then = update.length
				? db`do update set ${list(update.map((c) => db`${db(c)} = excluded.${db(c)}`))}`
				: db`do nothing`;
			return db`insert into ${db(table)} ${db(rows)} on conflict (${list(keys.map((k) => db(k)))}) ${then}`;
		}
		// MySQL has no "do nothing": setting a key to itself changes nothing.
		const then = update.length
			? list(update.map((c) => db`${db(c)} = values(${db(c)})`))
			: db`${db(keys[0]!)} = ${db(keys[0]!)}`;
		return db`insert into ${db(table)} ${db(rows)} on duplicate key update ${then}`;
	}

	/**
	 * Insert one row unless it is there already.
	 * The table must have an auto-increment `id`.
	 * @param db The connection or transaction.
	 * @param table The table.
	 * @param row The row, as an object of column → value.
	 * @param keys The columns of the unique index that says "already there".
	 * @returns The new row's id, or null when the row was there.
	 */
	static async insertOnce(
		db: SQL,
		table: string,
		row: Record<string, unknown>,
		keys: string[],
	): Promise<number | null> {
		if (!mysql) {
			const [r] = await db`${Db.upsert(db, table, row, keys)} returning id`;
			return r ? Number(r.id) : null;
		}
		const done = await Db.upsert(db, table, row, keys);
		return done.affectedRows ? Number(done.lastInsertRowid) : null;
	}
}
