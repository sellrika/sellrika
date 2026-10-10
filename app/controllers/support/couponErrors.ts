import { t } from "@xcore/i18n/I18n";
import type { Key } from "@i18n";
import type { Errors } from "@validators/validate";

/**
 * The errors of a refused discount code, for the code box.
 * The page shows one message next to the box, under `coupon`.
 * @param errors The validation errors of the request.
 * @param fallback The dictionary key to use when no message fits.
 * @returns `{ coupon }` with the message to show.
 */
export function couponErrors(errors: Errors, fallback: Key): Errors {
	return {
		coupon: errors.coupon ?? Object.values(errors)[0] ?? t(fallback),
	};
}
