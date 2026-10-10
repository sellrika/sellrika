import { z } from "zod";
import { COUNTRY_NAMES } from "@constants/Country.Constant";
import { PHONE_PATTERN } from "@constants/Validation.Constant";
import { isEmail } from "@validators/Fields.Validator";
import type { Key } from "@i18n";

/**
 * A required, trimmed text field.
 * Messages are dictionary keys.
 * This schema runs in the browser too, so it never translates anything itself.
 * The checkout page and `validate()` each translate what comes back.
 * @param required The message key for an empty value.
 * @param tooLong The message key for a value that is too long.
 * @param max The most characters.
 * @returns The schema.
 */
function req(required: Key, tooLong: Key, max: number) {
	return z.string().trim().min(1, required).max(max, tooLong);
}

/**
 * Who is buying and where it goes: the checkout page's form.
 * It is the `customer` part of POST /checkout on a store's host.
 * One schema for both sides, so the rules can't drift.
 * The page validates with it before posting
 * (inline field errors, no browser bubbles).
 * `StoreCheckoutInput` embeds it on the server.
 * Plain zod + data only, so it bundles into the browser.
 */
export const StoreCustomerInput = z.object({
	/** The buyer's name. Needed, at most 100 characters. */
	name: req(
		"store.validation_name_required",
		"store.validation_name_too_long",
		100,
	),
	/**
	 * The buyer's phone number. Needed, at most 30 characters.
	 * Digits, spaces, `+ ( ) . -` only, at least 6.
	 */
	phone: req(
		"store.validation_phone_required",
		"store.validation_phone_too_long",
		30,
	).regex(PHONE_PATTERN, "store.validation_phone_invalid"),
	/** The buyer's email address. Needed, at most 200 characters. */
	email: req(
		"store.validation_email_required",
		"store.validation_email_too_long",
		200,
	).refine(isEmail, "store.validation_email_invalid"),
	/** The first address line. Needed, at most 200 characters. */
	address_1: req(
		"store.validation_address_required",
		"store.validation_address_too_long",
		200,
	),
	/**
	 * The one optional line (apartment, floor, …).
	 * At most 200 characters. Left out = "".
	 */
	address_2: z
		.string()
		.trim()
		.max(200, "store.validation_address_2_too_long")
		.default(""),
	/** The city. Needed, at most 100 characters. */
	city: req(
		"store.validation_city_required",
		"store.validation_city_too_long",
		100,
	),
	/** The state or province. Needed, at most 100 characters. */
	state: req(
		"store.validation_state_required",
		"store.validation_state_too_long",
		100,
	),
	/**
	 * The country, by its name in `COUNTRY_NAMES`.
	 * Needed.
	 */
	country: req(
		"store.validation_country_required",
		"store.validation_country_too_long",
		100,
	).refine((s) => COUNTRY_NAMES.has(s), "store.validation_country_invalid"),
	/**
	 * The postal code, at most 20 characters.
	 * Optional: some countries (Myanmar…) have none.
	 * The city name prices delivery then.
	 */
	postal_code: z
		.string()
		.trim()
		.max(20, "store.validation_postal_code_too_long")
		.default(""),
});
/** A checked `StoreCustomerInput`. */
export type StoreCustomerInput = z.infer<typeof StoreCustomerInput>;

/** The name of one field of the checkout form. */
export type StoreCustomerField = keyof StoreCustomerInput;

/**
 * An address line that may stay blank.
 * It is kept as "" so the shape is the same.
 * @param max The most characters.
 * @returns The schema.
 */
function opt(max: number) {
	return z.string().trim().max(max).default("");
}

/**
 * The buyer of an order that is collected in store.
 * Only who is buying is needed: name, phone and email.
 * The address lines may stay blank
 * (they're kept as "" so the shape is the same).
 * `StorePickupCheckoutInput` embeds it.
 */
export const StorePickupCustomerInput = StoreCustomerInput.extend({
	/** The first address line. May stay blank. */
	address_1: opt(200),
	/** The city. May stay blank. */
	city: opt(100),
	/** The state or province. May stay blank. */
	state: opt(100),
	/** The country. May stay blank, and is not checked. */
	country: opt(100),
	/** The postal code. May stay blank. */
	postal_code: opt(20),
});

/**
 * Check the checkout form.
 * The checkout page translates the keys with `t()` before showing them.
 * @param input The form, as typed.
 * @param pickup True when the buyer collects in store.
 * @returns Field → first message key. {} when valid.
 */
export function customerErrors(
	input: unknown,
	pickup = false,
): Partial<Record<StoreCustomerField, Key>> {
	const r = (pickup ? StorePickupCustomerInput : StoreCustomerInput).safeParse(
		input,
	);
	if (r.success) return {};
	const errors: Partial<Record<StoreCustomerField, Key>> = {};
	for (const issue of r.error.issues)
		errors[issue.path[0] as StoreCustomerField] ??= issue.message as Key;
	return errors;
}

/**
 * One shipping zone (`shops.delivery_zones`, migration 0045).
 * A group of places that share one delivery price.
 */
export type DeliveryZone = {
	/** For the admin's list only ("Domestic", "Asia"…). */
	name: string;
	/**
	 * Country names (Country.Constant).
	 * [] = every country no other zone lists ("rest of world").
	 */
	countries: string[];
	/**
	 * Narrows the zone to these states / provinces
	 * (GeoNames admin1 names, or as typed).
	 * [] = the whole country.
	 */
	states: string[];
	/**
	 * Narrows the zone to these cities.
	 * [] = every city (of the states, or the country).
	 */
	cities: string[];
	/** Cents. */
	fee: number;
	/**
	 * Cents. Goods at/above this ship free inside the zone.
	 * null = no threshold.
	 */
	free_delivery_min: number | null;
};

/** Delivery pricing the shop set: what `deliveryFee()` reads. */
export type DeliveryRules = { delivery_zones: DeliveryZone[] };

/** Where an order goes: the address fields that decide the price. */
export type DeliveryTo = { country: string; state: string; city: string };

/**
 * Make a place name comparable: no surrounding spaces, lower case.
 * @param s The name as typed.
 * @returns The name to compare with.
 */
function norm(s: string) {
	return s.trim().toLowerCase();
}

/**
 * How specific a zone is. A lower number is more specific.
 * @param z The zone.
 * @returns 0 for a city zone, 1 for a state zone,
 *   2 for a country zone, 3 for rest of world.
 */
function rank(z: DeliveryZone) {
	return z.cities.length ? 0 : z.states.length ? 1 : z.countries.length ? 2 : 3;
}

/**
 * The zone an address falls in: the most specific one that lists it.
 * A zone naming the city beats one naming the state.
 * That beats one naming the whole country.
 * That beats a rest-of-world zone.
 * Between equals the first listed wins.
 * @param zones The shop's zones.
 * @param to The buyer's country, state and city
 *   (state / city as typed, case and surrounding spaces ignored).
 * @returns The zone, or null when the shop doesn't deliver there.
 */
export function deliveryZone(
	zones: DeliveryZone[],
	to: DeliveryTo,
): DeliveryZone | null {
	const city = norm(to.city),
		state = norm(to.state);
	let best: DeliveryZone | null = null;
	for (const z of zones) {
		if (z.countries.length && !z.countries.includes(to.country)) continue;
		if (z.states.length && !z.states.some((s) => norm(s) === state)) continue;
		if (z.cities.length && !z.cities.some((c) => norm(c) === city)) continue;
		if (!best || rank(z) < rank(best)) best = z;
	}
	return best;
}

/**
 * The delivery charge (cents) for an address.
 * Shared by the checkout page (live total) and
 * `StoreService.checkout` / `quote` (the charge that's actually made).
 * It takes the address's zone (`deliveryZone`):
 * free once the goods reach its `free_delivery_min`, else its `fee`.
 * Pick-up in store is decided before this is called
 * (the fee is 0 and no address is asked).
 * @param shop The shop's delivery settings.
 * @param to The buyer's country and city.
 * @param subtotal The goods (cents) before any discount code:
 *   what the free-delivery threshold looks at.
 * @returns The charge, or null when the shop doesn't deliver there.
 */
export function deliveryFee(
	shop: DeliveryRules,
	to: DeliveryTo,
	subtotal: number,
): number | null {
	const z = deliveryZone(shop.delivery_zones, to);
	return !z
		? null
		: z.free_delivery_min !== null && subtotal >= z.free_delivery_min
			? 0
			: z.fee;
}

/**
 * Where the shop delivers.
 * It is what the checkout's country box offers
 * (locked when there is only one).
 * @param zones The shop's zones.
 * @returns null = anywhere (a rest-of-world zone exists),
 *   else the countries its zones name, A–Z.
 */
export function deliveryCountries(zones: DeliveryZone[]): string[] | null {
	return zones.some((z) => !z.countries.length)
		? null
		: [...new Set(zones.flatMap((z) => z.countries))].sort();
}

/**
 * Why an address can't be delivered to.
 * The field to flag and the message key
 * (with the place to name, when the buyer typed one).
 * The caller translates it: `t(key, params)` on both sides.
 */
export type Undeliverable = {
	field: "country" | "state" | "city";
	key: Key;
	params?: { place: string };
};

/**
 * The same message twice: with the place the buyer typed,
 * or "that country / state / city" without one.
 * @param field The field to flag.
 * @param place The place the buyer typed, or "".
 * @param empty The message key to use when no place was typed.
 * @returns What to flag and what to say.
 */
function no(
	field: "country" | "state" | "city",
	place: string,
	empty: Key,
): Undeliverable {
	return place
		? { field, key: "store.validation_no_delivery", params: { place } }
		: { field, key: empty };
}

/**
 * Why an address can't be delivered to.
 * A country no zone names is the country box's problem.
 * A country covered only by state / city zones is the state's problem
 * (when no zone names that state), or the city's.
 * @param zones The shop's zones.
 * @param to The buyer's country, state and city.
 * @returns Which field to flag and what to say, or null when it can.
 */
export function undeliverable(
	zones: DeliveryZone[],
	to: DeliveryTo,
): Undeliverable | null {
	if (deliveryZone(zones, to)) return null;
	const countries = deliveryCountries(zones);
	if (countries && !countries.includes(to.country))
		return no("country", to.country, "store.validation_no_delivery_country");
	const state = norm(to.state);
	const stateKnown = zones.some(function coversState(z) {
		return (
			(!z.countries.length || z.countries.includes(to.country)) &&
			(!z.states.length || z.states.some((s) => norm(s) === state))
		);
	});
	return stateKnown
		? no("city", to.city.trim(), "store.validation_no_delivery_city")
		: no("state", to.state.trim(), "store.validation_no_delivery_state");
}
