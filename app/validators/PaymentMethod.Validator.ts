import { z } from "zod";
import { PAYMENT_ICON_NAMES } from "@constants/PaymentMethod.Constant";
import { Storage } from "@xcore/storage/Storage";
import { hexColor } from "@validators/Fields.Validator";

/**
 * One of the shop's payment methods.
 * POST /payment-methods and PUT /payment-methods/:id.
 * The REST API uses it too (`/api/v1/payment-methods`).
 */
export const PaymentMethodInput = z.object({
	/**
	 * The method's name, like "Cash".
	 * Needed, at most 50 characters.
	 */
	name: z.string().trim().min(1, "validation.name_required").max(50),
	/**
	 * The icon on the method's button: a lucide icon name.
	 * Left out = `Wallet`.
	 */
	icon: z
		.enum(PAYMENT_ICON_NAMES, { message: "validation.pick_an_icon" })
		.default("Wallet"),
	/** The button's colour as `#rrggbb`. null = no colour. */
	color: hexColor,
	/**
	 * A picture for the customer's screen while this method is picked
	 * (a QR code to pay).
	 * One of our own uploads, or null for none.
	 */
	image: z
		.string()
		.refine((s) => Storage.isUploadUrl(s), "validation.invalid_image")
		.nullable()
		.default(null),
	/** Cash-like: checkout asks for the amount tendered and shows change. */
	tendered: z.boolean().default(false),
	/**
	 * Off = hidden from checkout (and rejected there).
	 * It is kept in the list and on past orders.
	 */
	enabled: z.boolean().default(true),
});
/** A checked `PaymentMethodInput`. */
export type PaymentMethodInput = z.infer<typeof PaymentMethodInput>;
