import { t } from "@xcore/i18n/I18n";
import type {
	ConfigPrimitive,
	ConfigValue,
	ExtensionField,
} from "@validators/Extension.Validator";
import type { ExtensionFieldType } from "@constants/Extension.Constant";

/**
 * What one field of the settings form came to.
 * Either the value to store, or the message to show under the input.
 * `at` is `<row>.<sub-field>` when the input sits inside a list.
 */
export type ParsedSetting =
	| { value: ConfigValue; error?: never; at?: never }
	| { error: string; at?: string; value?: never };

/**
 * How one field type reads what the form sent.
 */
type Parser = (field: ExtensionField, value: ConfigValue) => ParsedSetting;

/**
 * One parser per field type.
 * The manifest's `type` picks the rules a value is read with.
 */
const PARSERS: Record<ExtensionFieldType, Parser> = {
	text: parseText,
	url: parseText,
	number: parseNumber,
	select: parseSelect,
	multiselect: parseMultiselect,
	switch: parseToggle,
	checkbox: parseToggle,
	color: parseColour,
	image: parseImage,
	list: parseRows,
};

/**
 * One setting as sent by the form, read into the value to store.
 * It is checked against the field's own type and rules.
 * A blank value means "not set", and is stored as such.
 * @param field The field, as the manifest declares it.
 * @param value What the form sent.
 * A number box arrives as text, a switch as a boolean.
 * @returns The value to store, or the message for the admin.
 */
export function parseSetting(
	field: ExtensionField,
	value: ConfigValue,
): ParsedSetting {
	return PARSERS[field.type](field, value);
}

/**
 * Has the admin given this field a value?
 * A switch or a checkbox always counts. "" and [] don't.
 * @param field The field.
 * @param value Its stored value.
 * @returns True when the field counts as set.
 */
export function isFilled(
	field: ExtensionField,
	value: ConfigValue | undefined,
): boolean {
	if (field.type === "switch" || field.type === "checkbox") return true;
	if (Array.isArray(value)) return value.length > 0;
	return value !== undefined && value !== "";
}

/**
 * What a field holds while unset.
 * @param field The field.
 * @returns False for a switch or checkbox, [] for a multiselect or list.
 * "" for the rest.
 */
export function blankValue(field: ExtensionField): ConfigValue {
	if (field.type === "switch" || field.type === "checkbox") return false;
	if (field.type === "multiselect" || field.type === "list") return [];
	return "";
}

/**
 * A text or url box.
 * Trimmed, then checked against the field's own rules.
 * Those are the `url` type itself, and `starts_with`.
 * @param field The field.
 * @param value What the form sent.
 * @returns The text to store, or a message.
 */
function parseText(field: ExtensionField, value: ConfigValue): ParsedSetting {
	if (typeof value !== "string") return { error: t("server.ext_enter_text") };
	const text = value.trim();
	if (field.type === "url" && text && !isHttpUrl(text))
		return { error: t("server.ext_enter_url") };
	if (field.starts_with && text && !text.startsWith(field.starts_with))
		return {
			error: t("server.ext_starts_with", {
				label: field.label,
				prefix: field.starts_with,
			}),
		};
	return { value: text };
}

/**
 * A number box.
 * Empty stays empty.
 * Anything else must be a number inside the field's range.
 * @param field The field. Its `min` and `max` are the range.
 * @param value What the form sent (text or a number).
 * @returns The number to store, or a message.
 */
function parseNumber(field: ExtensionField, value: ConfigValue): ParsedSetting {
	if (value === "" || value === undefined) return { value: "" };
	const number =
		typeof value === "number" ? value : Number(String(value).trim());
	if (
		typeof value === "boolean" ||
		Array.isArray(value) ||
		!Number.isFinite(number)
	)
		return { error: t("server.ext_enter_number") };
	if (field.min !== undefined && number < field.min)
		return { error: t("server.ext_min", { min: field.min }) };
	if (field.max !== undefined && number > field.max)
		return { error: t("server.ext_max", { max: field.max }) };
	return { value: number };
}

/**
 * A dropdown.
 * Empty, or one of the values the field offers.
 * @param field The field.
 * @param value What the form sent.
 * @returns The value to store, or a message.
 */
function parseSelect(field: ExtensionField, value: ConfigValue): ParsedSetting {
	if (value === "") return { value: "" };
	return typeof value === "string" && optionValues(field).includes(value)
		? { value }
		: { error: t("server.ext_pick_option") };
}

/**
 * A multiselect.
 * A list of the field's own option values, without repeats.
 * @param field The field.
 * @param value What the form sent.
 * @returns The list to store, or a message.
 */
function parseMultiselect(
	field: ExtensionField,
	value: ConfigValue,
): ParsedSetting {
	if (value === "") return { value: [] };
	const picked =
		Array.isArray(value) && value.every((item) => typeof item === "string")
			? (value as string[])
			: null;
	const options = optionValues(field);
	return picked?.every((item) => options.includes(item))
		? { value: [...new Set(picked)] }
		: { error: t("server.ext_pick_options") };
}

/**
 * A switch or a checkbox.
 * On or off, however the form spelled it.
 * @param _field The field. Its type already picked this parser.
 * @param value What the form sent.
 * @returns True or false.
 */
function parseToggle(
	_field: ExtensionField,
	value: ConfigValue,
): ParsedSetting {
	return { value: value === true || value === "1" || value === "true" };
}

/**
 * A colour swatch.
 * What `<input type="color">` sends, and nothing else.
 * The value lands in a style attribute.
 * @param _field The field.
 * @param value What the form sent.
 * @returns The `#rrggbb` value to store, or a message.
 */
function parseColour(
	_field: ExtensionField,
	value: ConfigValue,
): ParsedSetting {
	if (typeof value !== "string") return { error: t("server.ext_enter_text") };
	const colour = value.trim().toLowerCase();
	return !colour || /^#[0-9a-f]{6}$/.test(colour)
		? { value: colour }
		: { error: t("server.ext_pick_colour") };
}

/**
 * A picture.
 * An upload of this site (`/uploads/…`), or a full https link.
 * Never `javascript:`, which would land in a `src`.
 * @param _field The field.
 * @param value What the form sent.
 * @returns The URL to store, or a message.
 */
function parseImage(_field: ExtensionField, value: ConfigValue): ParsedSetting {
	if (typeof value !== "string") return { error: t("server.ext_enter_text") };
	const src = value.trim();
	return !src || src.startsWith("/uploads/") || isHttpUrl(src)
		? { value: src }
		: { error: t("server.ext_enter_url") };
}

/**
 * A list field: rows of sub-fields.
 * Each cell is read like a top-level field.
 * A row that is there must be complete.
 * @param field The list field. Its `fields` are the columns.
 * @param value What the form sent.
 * @returns The rows to store, or a message pointing at the cell.
 */
function parseRows(field: ExtensionField, value: ConfigValue): ParsedSetting {
	if (value === "") return { value: [] };
	if (
		!Array.isArray(value) ||
		!value.every(
			(row) => typeof row === "object" && row !== null && !Array.isArray(row),
		)
	)
		return { error: t("server.ext_list_rows") };
	const rows: Record<string, ConfigPrimitive>[] = [];
	for (const [index, sent] of (
		value as Record<string, ConfigPrimitive>[]
	).entries()) {
		const row: Record<string, ConfigPrimitive> = {};
		for (const sub of field.fields ?? []) {
			const parsed = parseSetting(sub, sent[sub.name] ?? "");
			if (parsed.error !== undefined)
				return { error: parsed.error, at: `${index}.${sub.name}` };
			if (sub.required && !isFilled(sub, parsed.value))
				return {
					error: t("server.ext_field_required", { label: sub.label }),
					at: `${index}.${sub.name}`,
				};
			row[sub.name] = parsed.value as ConfigPrimitive; // a sub-field is never a list
		}
		rows.push(row);
	}
	return { value: rows };
}

/**
 * The values a select / multiselect offers.
 * @param field The field.
 * @returns Its option values, empty when it has none.
 */
function optionValues(field: ExtensionField): string[] {
	return field.options?.map((option) => option.value) ?? [];
}

/**
 * A http or https URL.
 * The only kind a `type: "url"` or `type: "image"` field accepts.
 * @param value What the admin typed.
 * @returns True when it is a http or https link.
 */
function isHttpUrl(value: string): boolean {
	return URL.canParse(value) && /^https?:$/.test(new URL(value).protocol);
}
