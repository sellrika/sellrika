import { z } from "zod";
import {
	blankToNull,
	isEmail,
	nullableText,
	personName,
} from "@validators/Fields.Validator";

/**
 * One customer of the shop.
 * POST /customers and PUT /customers/:id.
 * An extension's `customers.create()` uses it too.
 */
export const CustomerInput = z.object({
	/** The customer's name. Needed, at most 100 characters. */
	name: personName,
	/**
	 * The phone number, at most 30 characters.
	 * Blank becomes null.
	 */
	phone: nullableText(30, "validation.phone_too_long"),
	/**
	 * The email address, at most 200 characters.
	 * Blank becomes null.
	 */
	email: z
		.string()
		.trim()
		.max(200)
		.nullable()
		.default(null)
		.transform(blankToNull)
		.refine((s) => s === null || isEmail(s), "validation.enter_valid_email"),
	/**
	 * A free note about the customer.
	 * At most 1000 characters. Left out = "".
	 */
	note: z.string().trim().max(1000).default(""),
});
/** A checked `CustomerInput`. */
export type CustomerInput = z.infer<typeof CustomerInput>;

/**
 * A short text of an address that may stay blank.
 * @param max The most characters it takes.
 * @returns The zod type. Left out = "".
 */
function blank(max: number) {
	return z.string().trim().max(max).default("");
}

/**
 * One address of a customer, as staff type it.
 * POST /customers/:id/addresses and PUT /customers/:id/addresses/:address.
 * Looser than the store checkout's rules: only the first line is needed,
 * and the country is free text.
 */
export const CustomerAddressInput = z.object({
	/** A name for the address ("Home", "Office"…). At most 40 characters. */
	label: blank(40),
	/** The phone to reach whoever receives it. At most 30 characters. */
	phone: blank(30),
	/** The street and number. Needed, at most 200 characters. */
	address_1: z.string().trim().min(1, "validation.address_required").max(200),
	/** Apartment, floor… At most 200 characters. */
	address_2: blank(200),
	/** The city. At most 100 characters. */
	city: blank(100),
	/** The state or province. At most 100 characters. */
	state: blank(100),
	/** The country. At most 100 characters. */
	country: blank(100),
	/** The postal code. At most 20 characters. */
	postal_code: blank(20),
	/**
	 * The tax or VAT number that goes with this address, as free text
	 * (any country, no format checked). At most 50 characters.
	 */
	tax_id: blank(50),
});
/** A checked `CustomerAddressInput`. */
export type CustomerAddressInput = z.infer<typeof CustomerAddressInput>;
