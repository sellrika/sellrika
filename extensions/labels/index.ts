/**
 * Labels.
 * The server half only lists products for the page.
 * Drawing and printing the labels happens in the browser.
 */
import type { ApiFunctions, Routes } from "../types";
import type { Unit } from "./assets/utils.ts";

/**
 * How many products one search asks for.
 */
const PER_PAGE = 30;

/**
 * One product of the API's list.
 */
type Product = Awaited<
	ReturnType<ApiFunctions["products"]["list"]>
>["data"][number];

/**
 * Turn a product into what gets a label.
 * A product with variants gives one unit per variant, because each
 * variant has its own price and barcode.
 * The code is the barcode, or "" when it has none.
 * The SKU is not used: the Sell screen's scanner only finds a barcode.
 * @param p The product.
 * @returns Its units.
 */
export function unitsOf(p: Product): Unit[] {
	if (!p.variants.length)
		return [
			{
				key: String(p.id),
				name: p.name,
				variant: "",
				price: p.price,
				code: p.barcode ?? "",
				image: p.images[0] ?? "",
			},
		];
	return p.variants.map(function variantUnit(v) {
		return {
			key: `${p.id}:${v.id}`,
			name: p.name,
			variant: v.name,
			price: v.price,
			code: v.barcode ?? "",
			image: v.images[0] ?? p.images[0] ?? "",
		};
	});
}

/**
 * Staff routes, served under `/ext/labels/…`.
 */
export const routes: Routes = {
	/**
	 * The products that match `?q=`, as units.
	 * An empty `q` gives the first page of the product list.
	 */
	"GET /products": async ({ url, products }) => {
		const q = url.searchParams.get("q")?.trim();
		const list = await products.list({ q: q || undefined, per_page: PER_PAGE });
		return { items: list.data.flatMap(unitsOf) };
	},
};

/**
 * The event listeners of this extension.
 * There are none: it only serves the route above.
 */
export default {};
