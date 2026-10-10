import type { Category } from "./Category";

/**
 * A plain sellable product,
 * or a package ("bundle") whose contents are other products.
 */
export type ProductKind = "item" | "bundle";
/**
 * One allowed way to fill a slot.
 * `stock` null = that component isn't tracked.
 * `name` = variant name,
 * or the component product's name when variant_id is null.
 */
export type BundleOption = {
	variant_id: number | null;
	name: string;
	price: number;
	stock: number | null;
};
/**
 * One slot of a package: `qty` × the component product.
 * It is filled by exactly one of `options`.
 * 1 option = fixed, 2+ = the customer chooses.
 */
export type BundleItem = {
	id: number;
	product_id: number;
	qty: number;
	name: string;
	/**
	 * The component's own on/off switch.
	 * A package with a switched-off component is not sold.
	 */
	active: boolean;
	options: BundleOption[];
};
/**
 * One "Additional data" row of a product: any title, any text value.
 * Darreichungsform → Tabletten, Hersteller → Bayer.
 */
export type ProductExtra = { title: string; value: string };

/** One product, as the `products` table keeps it. Money is cents. */
export type Product = {
	id: number;
	shop_id: number;
	name: string;
	/**
	 * Storefront URL (<store>/p/<slug>).
	 * Unique per shop, derived from the name.
	 */
	slug: string;
	description: string;
	/** Cents (base price; variants override). */
	price: number;
	/** Cents, optional. */
	purchase_price: number | null;
	/**
	 * Cents, optional "was" price.
	 * Display only, drives the storefront discount.
	 */
	original_price: number | null;
	/** ["/uploads/<file>", "https://…", …]; stored as JSON text. */
	images: string[];
	/**
	 * Optional merchant SKU, free text.
	 * Per variant when the product has variants.
	 */
	sku: string | null;
	barcode: string | null;
	/** Sale unit ("pcs", "kg", "m", …). */
	unit: string | null;
	/**
	 * How much one unit holds — 50 for "50 g".
	 * The unit is `unit`.
	 */
	amount: number | null;
	/**
	 * "Additional data" rows in the order typed.
	 * Stored as JSON text.
	 */
	extra: ProductExtra[];
	/** Inventory on/off for this product (and its variants). */
	track_stock: boolean;
	/**
	 * Units sold on orders that were not voided.
	 * Only on the admin product list.
	 */
	sold?: number;
	/** On hand when the product has no variants. */
	stock: number;
	/** Alert when stock <= this. */
	low_stock_at: number;
	/** Pinned to the front of every product list. */
	featured: boolean;
	/**
	 * on = the online store asks the buyer for a note
	 * (like the name to engrave).
	 */
	custom_request: boolean;
	/** The question over that box, "" = the default words. */
	custom_request_label: string;
	/**
	 * false = hidden from the POS and the online store,
	 * greyed on the admin list.
	 */
	active: boolean;
	kind: ProductKind;
	/**
	 * [] for kind 'item'.
	 * For a package the repository also *computes*
	 * `track_stock`/`stock` from these slots.
	 */
	bundle_items: BundleItem[];
	created_at: string;
	/**
	 * Bumped on every product-form save.
	 * Lists are ordered by it.
	 */
	updated_at: string;
};
/** One variant of a product, as the `product_variants` table keeps it. */
export type ProductVariant = {
	id: number;
	product_id: number;
	name: string;
	price: number;
	purchase_price: number | null;
	position: number;
	attributes: Record<string, string> | null;
	sku: string | null;
	barcode: string | null;
	images: string[];
	stock: number;
};
/** A product with its categories and variants hanging off it. */
export type ProductFull = Product & {
	categories: Category[];
	variants: ProductVariant[];
};
