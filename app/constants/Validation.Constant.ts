/**
 * Patterns that more than one form checks a field with.
 * No imports: the checkout page in the browser reads this file too.
 */

/** A phone number typed any way: digits, spaces, `+ ( ) . -`, six or more. */
export const PHONE_PATTERN = /^\+?[\d\s().-]{6,}$/;

/**
 * A slug: lower-case letters, digits and dashes.
 * It may not start or end with a dash.
 */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** A colour as `#rrggbb`. */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * A `YYYY-MM-DD` day, or blank.
 * `YMD_PATTERN` in `Report.Constant.ts` is the one that refuses blank.
 */
export const YMD_OR_BLANK_PATTERN = /^(\d{4}-\d{2}-\d{2})?$/;
