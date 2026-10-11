import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
/** The `key` column: a reserved word in MySQL, so it is always quoted. */
const KEY = sql("key");

/**
 * App-level key/value settings.
 * Not shop-scoped, see migration 0031.
 * `value` is a JSON string.
 */
@Service()
export class SettingRepository {
	/**
	 * Read one setting.
	 * @param key Setting key.
	 * @returns The stored JSON string, or null when the key was never written.
	 */
	async get(key: string): Promise<string | null> {
		return (
			(await sql`select value from settings where ${KEY} = ${key}`)[0]?.value ??
			null
		);
	}

	/**
	 * Write one setting, overwriting whatever was there.
	 * @param key Setting key.
	 * @param value JSON string to store.
	 */
	set(key: string, value: string) {
		return Db.upsert(sql, "settings", { key, value }, ["key"], ["value"]);
	}

	/**
	 * Remove one setting.
	 * @param key Setting key.
	 */
	delete(key: string) {
		return sql`delete from settings where ${KEY} = ${key}`;
	}
}
