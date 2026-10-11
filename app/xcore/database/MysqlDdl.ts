import type { SQL } from "bun";

/** The longest text MySQL can put in an index (utf8mb4). */
const KEY_LENGTH = 191;

/**
 * Turns the migrations' SQL into SQL that MySQL reads.
 * The migrations are written once, for SQLite and Postgres.
 * MySQL reads some of it differently. All of that is said here, in one place.
 */
export class MysqlDdl {
	/**
	 * A connection whose `unsafe()` translates first.
	 * The migration runner hands it to every migration on MySQL.
	 * @param db The connection or transaction.
	 * @returns The same connection, with `unsafe` replaced.
	 */
	static wrap(db: SQL): SQL {
		return new Proxy(db, {
			get(target, prop, receiver) {
				if (prop !== "unsafe") return Reflect.get(target, prop, receiver);
				return function unsafe(text: string, values?: unknown[]) {
					return MysqlDdl.run(target, text, values);
				};
			},
		});
	}

	/**
	 * Translate one statement and run it.
	 * @param db The connection or transaction.
	 * @param text The statement, as written for SQLite and Postgres.
	 * @param values Its parameters, if any.
	 * @returns The driver's result. Empty when the index is there already.
	 */
	static async run(db: SQL, text: string, values?: unknown[]) {
		const index = MysqlDdl.#index(text);
		if (!index) return db.unsafe(MysqlDdl.rewrite(text), values);
		if (index.optional && (await MysqlDdl.#hasIndex(db, index))) return [];
		return db.unsafe(
			MysqlDdl.indexSql(index, await MysqlDdl.#textColumns(db, index.table)),
		);
	}

	/**
	 * The parts of rewriting that need no database.
	 * @param text A statement that is not `create index`.
	 * @returns The statement for MySQL.
	 */
	static rewrite(text: string): string {
		const lines = [];
		for (const line of text.split("\n")) lines.push(MysqlDdl.#line(line));
		const out = MysqlDdl.#quote(lines.join("\n"));
		if (!/^\s*create table/i.test(out)) return out;
		/**
		 * `utf8mb4_bin` compares text byte by byte, like Postgres does.
		 * MySQL's own default would make "abc" equal to "ABC".
		 */
		return `${out} engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin`;
	}

	/**
	 * Write a `create index` for MySQL.
	 * @param index The parts of the statement.
	 * @param textColumns The table's columns of type `text`.
	 * @returns The statement for MySQL.
	 */
	static indexSql(index: IndexParts, textColumns: Set<string>): string {
		const cols = [];
		for (const col of index.columns) {
			// MySQL indexes only the start of a `text` column
			const length = textColumns.has(col) ? `(${KEY_LENGTH})` : "";
			cols.push(`\`${col}\`${length}`);
		}
		const unique = index.unique ? "unique " : "";
		return `create ${unique}index ${index.name} on ${index.table} (${cols.join(", ")})`;
	}

	/**
	 * Rewrite one line of `create table` or `alter table`: one column.
	 * @param line The line.
	 * @returns The line for MySQL.
	 */
	static #line(line: string): string {
		// `timestamp` ends in 2038 and changes itself on old servers
		let out = line.replace(/\btimestamp\b/g, "datetime");
		/**
		 * MySQL reads `references` on a column and does nothing with it.
		 * MariaDB makes a real foreign key. Leave it out, so both act the same.
		 */
		out = out.replace(/\s+references \w+\s*\(\w+\)/i, "");
		if (!/\btext\b/.test(out)) return out;
		// MySQL cannot make a key of a text column without a length
		if (/\b(primary key|unique)\b/.test(out))
			return out.replace(/\btext\b/, `varchar(${KEY_LENGTH})`);
		// MySQL takes a default on a text column only inside brackets
		out = out.replace(/\bdefault ('(?:[^']|'')*')/, "default ($1)");
		// MySQL's `text` holds only 64 KB: too small for a page or a cart
		return out.replace(/\btext\b/, "longtext");
	}

	/**
	 * Quote the column names that are reserved words in MySQL.
	 * @param text The statement.
	 * @returns The statement with `key` and `change` in backticks.
	 */
	static #quote(text: string): string {
		return text
			.replace(/(?<!primary )\bkey\b/g, "`key`")
			.replace(/\bchange\b/g, "`change`");
	}

	/**
	 * Read a `create index` statement.
	 * @param text Any statement.
	 * @returns Its parts, or null when it is another kind of statement.
	 */
	static #index(text: string): IndexParts | null {
		const m = text.match(
			/^\s*create (unique )?index (if not exists )?(\w+) on (\w+) \(([^)]+)\)(.*)$/is,
		);
		if (!m) return null;
		const where = m[6]!.trim();
		/**
		 * MySQL has no partial index.
		 * `where x is not null` on a unique index needs none:
		 * MySQL lets many rows have null in a unique index.
		 */
		if (where && !/^where \w+ is not null$/i.test(where))
			throw new Error(`MySQL cannot make this index: ${text}`);
		return {
			unique: !!m[1],
			optional: !!m[2],
			name: m[3]!,
			table: m[4]!,
			columns: m[5]!.split(",").map((c) => c.trim()),
		};
	}

	/**
	 * Is the index there already? MySQL has no `if not exists` for it.
	 * @param db The connection.
	 * @param index The index.
	 * @returns True when the table has an index of that name.
	 */
	static async #hasIndex(db: SQL, index: IndexParts) {
		const rows =
			await db`select 1 from information_schema.statistics where table_schema = database() and table_name = ${index.table} and index_name = ${index.name} limit 1`;
		return rows.length > 0;
	}

	/**
	 * The `text` columns of a table.
	 * @param db The connection.
	 * @param table The table.
	 * @returns Their names.
	 */
	static async #textColumns(db: SQL, table: string) {
		const rows: { name: string }[] =
			await db`select column_name as name from information_schema.columns where table_schema = database() and table_name = ${table} and data_type like '%text'`;
		return new Set(rows.map((r) => r.name));
	}
}

/** The parts of a `create index` statement. */
export type IndexParts = {
	unique: boolean;
	/** It was written with `if not exists`. */
	optional: boolean;
	name: string;
	table: string;
	columns: string[];
};
