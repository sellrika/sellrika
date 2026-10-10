/**
 * Read a JSON column of a database row.
 * SQLite hands it back as text, Postgres may hand it back already parsed.
 * An empty column (null or "") gives the fallback.
 * @param value The column as the driver returned it.
 * @param fallback What an empty column means.
 * @returns The parsed value.
 */
export function parseJson<T>(value: unknown, fallback: T): T {
	if (value == null || value === "") return fallback;
	return typeof value === "string" ? JSON.parse(value) : (value as T);
}

/**
 * A value as JSON that is safe to print inside a `<script>` tag.
 * `<` becomes `\u003c`, so no `</script>` can close the tag early.
 * @param value Any JSON-able value.
 * @returns The JSON text. "null" for a value JSON can not write.
 */
export function safeJson(value: unknown): string {
	return (JSON.stringify(value) ?? "null").replace(/</g, "\\u003c");
}
