/**
 * What the page and the route share: the unit shape, the label sizes,
 * the limits, a fetch that throws and the price text.
 */

/**
 * One thing that gets a label, as `GET /products` answers.
 * It is a product, or one variant of a product.
 */
export type Unit = {
	/**
	 * The product id, with the variant id after a colon when it is a variant.
	 */
	key: string;
	/**
	 * The product name.
	 */
	name: string;
	/**
	 * The variant name, or "" when it is a product with no variants.
	 */
	variant: string;
	/**
	 * The price in cents.
	 */
	price: number;
	/**
	 * What the bars hold: the product's barcode, or "" when it has none.
	 */
	code: string;
	/**
	 * The picture, or "".
	 */
	image: string;
};

/**
 * A label size the page offers.
 */
export type Size = {
	/**
	 * Its name in the dictionary is `size.<id>`.
	 */
	id: string;
	/**
	 * The width of one label in mm.
	 */
	w: number;
	/**
	 * The height of one label in mm.
	 */
	h: number;
	/**
	 * Labels across an A4 sheet.
	 * 0 = a roll: every label is its own page.
	 */
	cols: number;
	/**
	 * Labels down an A4 sheet. 0 for a roll.
	 */
	rows: number;
};

/**
 * The size the page starts with.
 */
export const DEFAULT_SIZE: Size = {
	id: "50x30",
	w: 50,
	h: 30,
	cols: 0,
	rows: 0,
};
/**
 * The sizes, the default first.
 * ponytail: three common sizes, no margins or gaps on the sheet.
 * A sheet with gaps between its labels needs them added here.
 */
export const SIZES: Size[] = [
	DEFAULT_SIZE,
	{ id: "40x30", w: 40, h: 30, cols: 0, rows: 0 },
	{ id: "a4-24", w: 70, h: 37, cols: 3, rows: 8 },
];

/**
 * How many labels one print may hold.
 */
export const MAX_LABELS = 2000;

/**
 * How long the search box waits after the last keystroke.
 */
export const SEARCH_DEBOUNCE_MS = 350;

/**
 * What the label shows.
 */
export type Show = { name: boolean; price: boolean; code: boolean };

/**
 * Read a response as JSON.
 * @param res The response of `api.fetch`.
 * @returns The body.
 * @throws When the server refused the request.
 */
export async function json<T>(res: Response): Promise<T> {
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	return (await res.json()) as T;
}

/**
 * Cents as a price, like the app shows it: no ".00" when whole.
 * @param cents The price in cents.
 * @param currency The shop's currency.
 * @param locale The page's language.
 * @returns The price text.
 */
export function money(cents: number, currency: string, locale: string) {
	return new Intl.NumberFormat(locale, {
		style: "currency",
		currency,
		trailingZeroDisplay: "stripIfInteger",
	} as Intl.NumberFormatOptions).format(cents / 100);
}

/**
 * The name printed on a label: the product, then its variant.
 * @param unit The unit.
 * @returns The name.
 */
export function labelName(unit: Unit) {
	return unit.variant ? `${unit.name} · ${unit.variant}` : unit.name;
}
