import type { ListSort } from "@xcore/http/Paginate";

/**
 * The longest custom request a buyer may write for one cart line
 * (like the name to engrave), in characters.
 */
export const CUSTOM_REQUEST_MAX = 1000;

/**
 * Universal POS Product CSV v1: one row per sellable unit.
 * A product's variant rows share a `variant_group`
 * and carry a `variant_name`.
 * Prices are decimals ("4.50").
 * Barcodes stay strings (leading zeros survive).
 * Columns this POS has no data for (brand, tax, supplier, …)
 * export empty and are ignored on import.
 * Unknown columns are ignored too.
 */
export const CSV_COLUMNS = [
	"name",
	"sku",
	"price",
	"barcode",
	"currency",
	"cost",
	"category",
	"brand",
	"unit",
	"tax_rate",
	"price_includes_tax",
	"track_stock",
	"stock_quantity",
	"low_stock_threshold",
	"variant_group",
	"variant_name",
	"additional_barcodes",
	"supplier",
	"supplier_sku",
	"description",
	"active",
] as const;

/** An import bigger than this is refused outright. */
export const CSV_MAX_ROWS = 5000;

/** Largest CSV file the import endpoint accepts. */
export const CSV_MAX_BYTES = 2_000_000;

/**
 * The columns the admin product list can be sorted by
 * (`/products?sort=&dir=`).
 */
export const PRODUCT_SORTS = [
	"name",
	"category",
	"active",
	"stock",
	"price",
	"sold",
] as const;

/** A sort of the admin product list: the column and the direction. */
export type ProductSort = ListSort<(typeof PRODUCT_SORTS)[number]>;

/**
 * The most products one bulk action may touch at once
 * (e.g. "Add to categories").
 */
export const PRODUCT_BULK_MAX = 500;

/** The most categories one product may be in. */
export const PRODUCT_CATEGORIES_MAX = 200;

/** The most products one package may hold. */
export const BUNDLE_ITEMS_MAX = 100;

/**
 * The most variants one product may have.
 * It is also the most variants one package slot may allow.
 */
export const PRODUCT_VARIANTS_MAX = 500;

/** The most options one variant may have, like Color and Size. */
export const VARIANT_ATTRIBUTES_MAX = 100;

/** The longest option name of a variant ("Color"), in characters. */
export const VARIANT_ATTRIBUTE_NAME_MAX = 100;

/** The longest option value of a variant ("Red"), in characters. */
export const VARIANT_ATTRIBUTE_VALUE_MAX = 200;
