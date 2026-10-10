import type { SQL } from "bun";
import { RAW_TEXT_TAGS } from "@constants/Html.Constant";
import { sanitizeHtml } from "@helpers/html";

/** Every column that holds HTML cleaned on save. */
const COLUMNS = [
	["products", "description"],
	["campaigns", "body"],
	["store_pages", "body"],
] as const;

/**
 * The old cleaner let the inside of `<xmp>`, `<textarea>`, `<title>`…
 * out as live HTML.
 * This cleans the saved values that hold one of those tags again.
 * @param db The connection the migration runs on.
 */
export async function up(db: SQL) {
	for (const [table, column] of COLUMNS) {
		const where = RAW_TEXT_TAGS.map(
			(tag) => `lower(${column}) like '%<${tag}%'`,
		).join(" or ");
		const rows: { id: number; html: string }[] = await db.unsafe(
			`select id, ${column} as html from ${table} where ${where}`,
		);
		for (const row of rows)
			await db`update ${db(table)} set ${db({ [column]: await sanitizeHtml(row.html) })} where id = ${row.id}`;
	}
}
