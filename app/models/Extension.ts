import type { ConfigValue } from "@validators/Extension.Validator";

/**
 * One installed extension of a shop (`shop_extensions`, migration 0047).
 * `config` is the parsed JSON column.
 * Its values are by field type (string / number / boolean / string[]).
 * Secret fields stay encrypted (a string) in it.
 */
export type ShopExtension = {
	id: number;
	shop_id: number;
	/** The manifest key of the uploaded zip. */
	key: string;
	enabled: boolean;
	config: Record<string, ConfigValue>;
	created_at: string;
};
