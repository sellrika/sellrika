import { z } from "zod";
import { en } from "@i18n/en";
import { I18n, t } from "@xcore/i18n/I18n";
import type { Key, Locale } from "@i18n";

/** Field path → the first message of that field. */
export type Errors = Record<string, string>;

/**
 * Zod's own wording ("Too big: …", "Invalid email") per language.
 * A schema's custom message is always a dictionary key instead
 * (`z.string().min(1, "validation.name_required")`).
 * It is translated below.
 */
const zodLocales: Record<Locale, z.core.$ZodErrorMap> = {
	/** English. */
	en: z.locales.en().localeError,
	/** German. */
	de: z.locales.de().localeError,
	/** Thai. */
	th: z.locales.th().localeError,
};

/**
 * Is this message one of our dictionary keys?
 * If not, it is one of Zod's own default messages.
 * @param message A Zod issue message.
 * @returns True when the dictionary has it.
 */
function isKey(message: string): message is Key {
	return message in en;
}

/**
 * Parse `input` with `schema`.
 * The errors are Inertia-shaped: the first message per field.
 * Every message is in the request's language.
 * @param schema The zod schema.
 * @param input The raw body.
 * @returns {data} with the parsed data, or {errors} keyed by field path.
 */
export function validate<T extends z.ZodType>(
	schema: T,
	input: unknown,
): { data: z.infer<T>; errors?: never } | { errors: Errors; data?: never } {
	const r = schema.safeParse(input, { error: zodLocales[I18n.current()] });
	if (r.success) return { data: r.data };
	const errors: Errors = {};
	for (const issue of r.error.issues) {
		const key = issue.path.join(".") || "_";
		errors[key] ??= isKey(issue.message) ? t(issue.message) : issue.message;
	}
	return { errors };
}
