import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import { parseJson } from "@helpers/json";
import { sqlStamp } from "@helpers/time";
import { Paginate } from "@xcore/http/Paginate";
import type { ShopExtension } from "@models/Extension";

/** The `key` column: a reserved word in MySQL, so it is always quoted. */
const KEY = sql("key");

/**
 * The platform admin's rule for one extension.
 * On for the shops or not, and for which owners ([] = every user).
 */
export type GlobalRule = { enabled: boolean; users: number[] };

/**
 * A `shop_extensions` row as the driver returns it.
 * SQLite returns booleans as 0/1.
 * `config` is a JSON string in the column.
 */
type ExtensionRow = Omit<ShopExtension, "enabled" | "config"> & {
	enabled: unknown;
	config: string | null;
};

/**
 * One list an extension keeps for one shop
 * (`ctx.data.collection(name)`).
 */
export type DataList = { shopId: number; key: string; name: string };

/**
 * One record of such a list (`extension_rows`).
 * `ref` is the lookup key the extension picked, "" when none.
 */
export type DataRow = {
	id: number;
	ref: string;
	value: unknown;
	created_at: string;
	updated_at: string;
};

/** A `platform_extensions` row as the driver returns it. */
type RuleRow = { key: string; enabled: unknown; users: string };

/**
 * A shop's installed extensions, one row per shop + key.
 * And the platform's on/off switch per key.
 * Never sends `config` to the client as-is: secrets are encrypted in it.
 */
@Service()
export class ExtensionRepository {
	/**
	 * Every extension a shop installed.
	 * @param shopId Owning shop.
	 * @returns The rows, oldest first.
	 */
	async allForShop(shopId: number): Promise<ShopExtension[]> {
		return (
			await sql`select * from shop_extensions where shop_id = ${shopId} order by id`
		).map((r: ExtensionRow) => this.#row(r));
	}

	/**
	 * One installed extension.
	 * @param shopId Owning shop.
	 * @param key The extension key.
	 * @returns The row, or null when the shop never installed it.
	 */
	async find(shopId: number, key: string): Promise<ShopExtension | null> {
		return Db.one(
			sql`select * from shop_extensions where shop_id = ${shopId} and ${KEY} = ${key}`,
			(r) => this.#row(r),
		);
	}

	/**
	 * Install or update.
	 * Writes the switch and the settings, creating the row on first use.
	 * @param shopId Owning shop.
	 * @param key The extension key.
	 * @param enabled Whether it runs.
	 * @param config The settings to store, by field type.
	 *   Secret fields are already encrypted.
	 */
	async upsert(
		shopId: number,
		key: string,
		enabled: boolean,
		config: ShopExtension["config"],
	) {
		const json = JSON.stringify(config);
		await Db.upsert(
			sql,
			"shop_extensions",
			{ shop_id: shopId, key, enabled, config: json },
			["shop_id", "key"],
			["enabled", "config"],
		);
	}

	/**
	 * The platform admin's rules per extension (`platform_extensions`):
	 * switched on for the shops or not, and which owners may use it.
	 * @returns key → `{enabled, users}`; `users` = owner ids, [] = every user.
	 */
	async globalRules(): Promise<Map<string, GlobalRule>> {
		const rows: RuleRow[] =
			await sql`select ${KEY}, enabled, users from platform_extensions`;
		return new Map(rows.map((r) => this.#ruleEntry(r)));
	}

	/**
	 * Which owners may use an extension, creating its row (switched off) on first use.
	 * @param key The extension key.
	 * @param users The owners' user ids; [] = every user.
	 */
	async setUsers(key: string, users: number[]) {
		const json = JSON.stringify(users);
		await Db.upsert(
			sql,
			"platform_extensions",
			{ key, enabled: false, users: json },
			["key"],
			["users"],
		);
	}

	/**
	 * Switch an extension on or off for all shops, creating its row on first use.
	 * @param key The extension key.
	 * @param enabled Whether it may run in the shops.
	 */
	async setGlobal(key: string, enabled: boolean) {
		await Db.upsert(
			sql,
			"platform_extensions",
			{ key, enabled },
			["key"],
			["enabled"],
		);
	}

	/**
	 * Forget an extension's platform switch (its code was deleted).
	 * The shops' settings stay, so a new upload of the same key finds them again.
	 * @param key The extension key.
	 */
	async forgetGlobal(key: string) {
		await sql`delete from platform_extensions where ${KEY} = ${key}`;
	}

	/**
	 * One value an extension keeps for a shop (`ctx.data.get`).
	 * @param shopId The shop.
	 * @param key The extension key.
	 * @param name The extension's name for the value.
	 * @returns The value, or null when none is kept.
	 */
	async getData(shopId: number, key: string, name: string): Promise<unknown> {
		const [r] =
			await sql`select value from extension_data where shop_id = ${shopId} and ext_key = ${key} and name = ${name}`;
		return r ? parseJson(r.value, null) : null;
	}

	/**
	 * Keep a value for an extension and a shop, replacing the old one (`ctx.data.set`).
	 * @param shopId The shop.
	 * @param key The extension key.
	 * @param name The extension's name for the value.
	 * @param value Any JSON value.
	 */
	async setData(shopId: number, key: string, name: string, value: unknown) {
		const json = JSON.stringify(value ?? null);
		await Db.upsert(
			sql,
			"extension_data",
			{
				shop_id: shopId,
				ext_key: key,
				name,
				value: json,
				updated_at: sqlStamp(new Date()),
			},
			["shop_id", "ext_key", "name"],
			["value", "updated_at"],
		);
	}

	/**
	 * Forget a value an extension kept (`ctx.data.delete`).
	 * @param shopId The shop.
	 * @param key The extension key.
	 * @param name The extension's name for the value.
	 */
	async deleteData(shopId: number, key: string, name: string) {
		await sql`delete from extension_data where shop_id = ${shopId} and ext_key = ${key} and name = ${name}`;
	}

	/**
	 * Add a record to a list an extension keeps (`collection.add`).
	 * @param list The shop, the extension and its list.
	 * @param value Any JSON value.
	 * @param ref The lookup key the extension picks, "" = none.
	 * @returns The new record's id.
	 */
	async addRow(list: DataList, value: unknown, ref: string): Promise<number> {
		const json = JSON.stringify(value ?? null);
		const [r] = await Db.insert(
			sql,
			"extension_rows",
			sql`insert into extension_rows (shop_id, ext_key, collection, ref, value)
      values (${list.shopId}, ${list.key}, ${list.name}, ${ref}, ${json})`,
			sql`id`,
		);
		return Number(r.id);
	}

	/**
	 * One record of a list (`collection.get`).
	 * @param list The shop, the extension and its list.
	 * @param id The record's id.
	 * @returns The record, or null when the list has none with that id.
	 */
	async getRow(list: DataList, id: number): Promise<DataRow | null> {
		const [r] =
			await sql`select id, ref, value, created_at, updated_at from extension_rows
      where id = ${id} and ${this.#inList(list)}`;
		return r ? this.#dataRow(r) : null;
	}

	/**
	 * One page of a list, newest first (`collection.list`).
	 * @param list The shop, the extension and its list.
	 * @param ref Only the records with this lookup key. Undefined = all.
	 * @param page The page number, from 1.
	 * @param perPage Rows per page.
	 * @returns The page with its counts.
	 */
	async listRows(
		list: DataList,
		ref: string | undefined,
		page: number,
		perPage: number,
	) {
		const where = sql`where ${this.#inList(list)} ${ref === undefined ? sql`` : sql`and ref = ${ref}`}`;
		const [count] =
			await sql`select count(*) as n from extension_rows ${where}`;
		const rows =
			await sql`select id, ref, value, created_at, updated_at from extension_rows
      ${where} order by id desc ${Paginate.limit(page, perPage)}`;
		return Paginate.of<DataRow>(
			rows.map(this.#dataRow),
			Number(count.n),
			page,
			perPage,
		);
	}

	/**
	 * Replace the value of one record (`collection.update`).
	 * @param list The shop, the extension and its list.
	 * @param id The record's id.
	 * @param value The new JSON value.
	 */
	async updateRow(list: DataList, id: number, value: unknown) {
		const json = JSON.stringify(value ?? null);
		await sql`update extension_rows set value = ${json}, updated_at = current_timestamp
      where id = ${id} and ${this.#inList(list)}`;
	}

	/**
	 * Delete one record (`collection.delete`).
	 * @param list The shop, the extension and its list.
	 * @param id The record's id.
	 */
	async deleteRow(list: DataList, id: number) {
		await sql`delete from extension_rows where id = ${id} and ${this.#inList(list)}`;
	}

	/**
	 * Delete every record with one lookup key (`collection.clear`).
	 * @param list The shop, the extension and its list.
	 * @param ref The lookup key.
	 */
	async clearRows(list: DataList, ref: string) {
		await sql`delete from extension_rows where ${this.#inList(list)} and ref = ${ref}`;
	}

	/**
	 * The filter every query of a list carries.
	 * It keeps an extension inside its own shop and its own rows.
	 * @param list The shop, the extension and its list.
	 * @returns The SQL condition.
	 */
	#inList(list: DataList) {
		return sql`shop_id = ${list.shopId} and ext_key = ${list.key} and collection = ${list.name}`;
	}

	/**
	 * Turn a database row into a `DataRow`.
	 * @param r The raw row.
	 * @returns The record with its value parsed.
	 */
	#dataRow(r: Record<string, unknown>): DataRow {
		return {
			id: Number(r.id),
			ref: String(r.ref),
			value: parseJson(String(r.value), null),
			created_at: r.created_at as string,
			updated_at: r.updated_at as string,
		};
	}

	/**
	 * Turn a database row into a `ShopExtension`.
	 * @param r The raw row.
	 * @returns The row with a real boolean and the parsed settings.
	 */
	#row(r: ExtensionRow): ShopExtension {
		return {
			...r,
			enabled: !!r.enabled,
			config: parseJson(r.config, {}),
		};
	}

	/**
	 * One entry of the `globalRules` map.
	 * @param r The raw `platform_extensions` row.
	 * @returns The key with its rule.
	 */
	#ruleEntry(r: RuleRow): [string, GlobalRule] {
		return [r.key, { enabled: !!r.enabled, users: parseJson(r.users, []) }];
	}
}
