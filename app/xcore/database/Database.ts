import { mkdirSync } from "node:fs"; // Bun has no sync mkdir
import { dirname } from "node:path";
import { SQL } from "bun";
import { database } from "@config/database";

/** The database in use: `sqlite` or `postgres`. */
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
export const ID_PK =
	dialect === "sqlite"
		? "integer primary key autoincrement"
		: "integer primary key generated always as identity";

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
	 * Use it with `select 1 …` or `update … returning id`.
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
}
