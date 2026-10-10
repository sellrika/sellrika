import { z } from "zod";
import { HEX_COLOR_PATTERN } from "@constants/Validation.Constant";

/**
 * Form fields that more than one validator uses.
 * Only `zod` and plain constants are imported here:
 * the checkout page in the browser bundles this file too.
 * So nothing here may import `@xcore/*`, `bun` or `node:*`.
 * Messages are dictionary keys; `validate()` translates them.
 */

/**
 * Is this text an email address?
 * @param s The text.
 * @returns True when zod's own email check passes.
 */
export function isEmail(s: string) {
	return z.email().safeParse(s).success;
}

/**
 * Turn a blank value into null.
 * @param v The text, or null.
 * @returns The text, or null when it is empty.
 */
export function blankToNull(v: string | null) {
	return v || null;
}

/**
 * An email address: trimmed and lower-cased.
 * A validator that caps the length adds its own `.max()`.
 */
export const email = z
	.email("validation.enter_valid_email")
	.trim()
	.toLowerCase();

/**
 * An email address that may be left out.
 * It is trimmed and lower-cased first. Blank becomes null.
 */
export const optionalEmail = z.preprocess(
	(v) => (typeof v === "string" ? v.trim().toLowerCase() : v) || null,
	z
		.string()
		.max(200)
		.refine(isEmail, "validation.enter_valid_email")
		.nullable()
		.default(null),
);

/**
 * A text field that may be left out: trimmed, and blank becomes null.
 * It takes null as input too.
 * @param max The most characters.
 * @param message The message key for a text that is too long.
 * @returns The schema.
 */
export function nullableText(max: number, message: string) {
	return z
		.string()
		.trim()
		.max(max, message)
		.nullable()
		.default(null)
		.transform(blankToNull);
}

/** A person's or a shop's name: needed, 100 characters at most. */
export const personName = z
	.string()
	.trim()
	.min(1, "validation.name_required")
	.max(100);

/** A colour as `#rrggbb`, or null for none. */
export const hexColor = z
	.string()
	.regex(HEX_COLOR_PATTERN, "validation.pick_valid_color")
	.nullable()
	.default(null);

/**
 * The fields of every provider at once: `credentials[key][field]`.
 * A blank secret means "keep the stored one".
 */
export const credentials = z
	.record(
		z.string().max(30),
		z.record(z.string().max(50), z.string().trim().max(500)),
	)
	.default({});

/**
 * Do both password boxes match?
 * @param d The form.
 * @returns True when they do.
 */
export function samePassword(d: {
	password: string;
	password_confirmation: string;
}) {
	return d.password === d.password_confirmation;
}

/** Where the "passwords do not match" message goes, and its key. */
export const PASSWORD_MISMATCH = {
	path: ["password_confirmation"],
	message: "validation.passwords_do_not_match",
};
