// Kept apart from the dictionaries: the store's browser scripts need `fill` without loading every language.

/** Values for the `{placeholders}` in a text. */
export type Params = Record<string, string | number>;

/**
 * Put `params` into the `{placeholders}` of a text (a placeholder with no value stays as it is).
 * Also used for extension dictionaries, which are not typed against this one.
 * @param text The text with placeholders.
 * @param params The values.
 * @returns The filled text.
 */
export function fill(text: string, params?: Params): string {
	if (!params) return text;
	return text.replace(/\{(\w+)\}/g, function one(match, name: string) {
		const v = params[name];
		return v === undefined ? match : String(v);
	});
}
