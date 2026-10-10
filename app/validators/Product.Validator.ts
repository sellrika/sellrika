import { z } from "zod";
import { Storage } from "@xcore/storage/Storage";
import { PRODUCT_BULK_MAX } from "@constants/Product.Constant";
import { nullableText } from "@validators/Fields.Validator";

/**
 * A money field, in whole cents.
 * @param field Names the two dictionary keys with this field's wording.
 * @returns The schema.
 */
function cents(
	field:
		| "price"
		| "purchase_price"
		| "original_price"
		| "variant_price"
		| "variant_purchase_price",
) {
	return z.coerce
		.number()
		.int(`validation.${field}_whole_cents`)
		.min(0, `validation.${field}_min_0`);
}

/**
 * The pictures of a product or a variant.
 * Uploads (`/uploads/<uuid>.<ext>`), https links and base64 pictures
 * may sit side by side.
 * A save swaps links and base64 for our own uploads.
 */
const images = z
	.array(
		z
			.string()
			.trim()
			.refine((s) => Storage.isImageUrl(s), "validation.invalid_image"),
	)
	.max(10, "validation.at_most_10_images")
	.default([])
	.describe(
		"Pictures, first = cover. Each entry is an https:// link, the picture itself as base64 (a data:image/…;base64, URI or plain base64, 5 MB at most), or an /uploads/… path the product already has. Links and base64 are saved into our storage.",
	);

/** A barcode: optional, blank becomes null. */
const barcode = nullableText(64, "validation.barcode_too_long");

/** A SKU: optional, blank becomes null. */
const sku = nullableText(64, "validation.sku_too_long");

/**
 * The stock count. Optional on purpose.
 * The product form never sends it (counts are set on /stock).
 * CSV import does.
 * Absent = keep the current count.
 */
const stock = z.coerce
	.number()
	.int("validation.stock_whole_number")
	.min(0, "validation.stock_not_negative")
	.optional();

/**
 * The product form. POST /products and PUT /products/:id.
 * The CSV import uses it too, and the REST API (`/api/v1/products`),
 * so MCP tools and an extension's `products.create()` as well.
 * Money is whole cents.
 */
export const ProductInput = z.object({
	/** The product's name. Needed, at most 200 characters. */
	name: z.string().trim().min(1, "validation.name_required").max(200),
	/**
	 * Rich text (HTML) from the description editor.
	 * It is sanitised in ProductService before it is stored.
	 */
	description: z
		.string()
		.trim()
		.max(200000, "validation.description_too_long")
		.default(""),
	/** The selling price, in whole cents. 0 or more. */
	price: cents("price"),
	/**
	 * What the shop pays for one unit, in whole cents.
	 * null = not known.
	 */
	purchase_price: cents("purchase_price").nullable().default(null),
	/**
	 * Optional "was" price, in whole cents.
	 * It is only shown (struck through, with a % off badge)
	 * when it is above `price`. It is never charged.
	 * null = none.
	 */
	original_price: cents("original_price").nullable().default(null),
	/**
	 * The product's pictures, 10 at most. The first is the cover.
	 * Uploads and https links are both taken.
	 * Left out = no pictures.
	 */
	images,
	/**
	 * The merchant's own code for the product.
	 * At most 64 characters. Blank becomes null.
	 */
	sku,
	/**
	 * The barcode, unique per shop.
	 * At most 64 characters. Blank becomes null.
	 */
	barcode,
	/**
	 * Sale unit ("pcs", "kg", "m", …), at most 20 characters.
	 * Free text: the predefined list lives in the UI.
	 * Blank becomes null.
	 */
	unit: nullableText(20, "validation.unit_too_long"),
	/**
	 * How much one unit holds: 50 for "50 g". The unit is `unit`.
	 * Optional so older callers need not send it.
	 */
	amount: z
		.number()
		.min(0, "validation.amount_not_negative")
		.max(1e9, "validation.amount_too_big")
		.nullish(),
	/**
	 * "Additional data" rows: any title, any text value.
	 * The repository drops untitled rows,
	 * so a blank row never fails the save.
	 * Optional so older callers (CSV import, tests) need not send it.
	 * Absent = no rows on create, kept as they are on update.
	 */
	extra: z
		.array(
			z.object({
				/** The row's title, at most 100 characters. */
				title: z.string().trim().max(100, "validation.title_too_long"),
				/** The row's text, at most 2000 characters. */
				value: z.string().trim().max(2000, "validation.value_too_long"),
			}),
		)
		.max(50, "validation.at_most_50_rows")
		.optional(),
	/**
	 * Inventory: when on, `stock` (no variants) or each variant's `stock`
	 * is decremented at checkout.
	 */
	track_stock: z.boolean().default(false),
	/**
	 * The stock count, a whole number, 0 or more.
	 * The product form never sends it. CSV import does.
	 * Absent = keep the current count.
	 */
	stock,
	/** Pinned to the top of every product list (admin, POS, storefront). */
	featured: z.boolean().default(false),
	/**
	 * On = the online store asks the buyer for a note when they add the product.
	 * Optional so older callers (CSV import, extensions) keep what is saved.
	 */
	custom_request: z.boolean().optional(),
	/**
	 * The question over the buyer's box, like "Name to engrave".
	 * "" = the default words.
	 */
	custom_request_label: z
		.string()
		.trim()
		.max(100, "validation.title_too_long")
		.optional(),
	/**
	 * Off = hidden from the POS and the online store.
	 * The admin list still shows it, greyed out.
	 */
	active: z.boolean().default(true),
	/**
	 * The count at which the product is shown as low on stock.
	 * A whole number, 0 or more. Left out = 0.
	 */
	low_stock_at: z.coerce
		.number()
		.int("validation.use_whole_number")
		.min(0, "validation.must_be_zero_or_more")
		.default(0),
	/**
	 * The categories the product is in.
	 * Left out = none.
	 */
	category_ids: z.array(z.coerce.number().int()).default([]),
	/**
	 * `item` = a normal product. Left out = `item`.
	 * `bundle` = a package of other products.
	 * A package has no variants, no stock and no cost of its own
	 * (ProductService normalises).
	 */
	kind: z.enum(["item", "bundle"]).default("item"),
	/**
	 * The package's slots: one per product in the package.
	 * Left out = none.
	 */
	bundle_items: z
		.array(
			z.object({
				/** The product this slot holds. */
				product_id: z.coerce.number().int(),
				/**
				 * The variants the slot allows.
				 * null = the component has no variants.
				 * 2+ ids = the customer picks one at sale time.
				 */
				variant_ids: z.array(z.coerce.number().int()).nullable().default(null),
				/** How many units of it one package holds: 1 to 100000. */
				qty: z.coerce
					.number()
					.int("validation.qty_whole_number")
					.min(1, "validation.at_least_1")
					.max(100000, "validation.too_many"),
			}),
		)
		.default([]),
	/**
	 * The product's variants. Left out = none.
	 * A product with variants is sold as a variant.
	 */
	variants: z
		.array(
			z.object({
				/** Present → update existing variant. */
				id: z.number().int().optional(),
				/**
				 * The variant's name, like "Red / M".
				 * Needed, at most 200 characters.
				 */
				name: z
					.string()
					.trim()
					.min(1, "validation.variant_name_required")
					.max(200),
				/** The variant's selling price, in whole cents. */
				price: cents("variant_price"),
				/**
				 * What the shop pays for one unit, in whole cents.
				 * null = the product's cost is used at checkout.
				 */
				purchase_price: cents("variant_purchase_price")
					.nullable()
					.default(null),
				/**
				 * The option values of this variant,
				 * like `{ "Color": "Red", "Size": "M" }`.
				 * null = none.
				 */
				attributes: z.record(z.string(), z.string()).nullable().default(null),
				/** The variant's own code. Blank becomes null. */
				sku,
				/** The variant's barcode, unique per shop. Blank becomes null. */
				barcode,
				/** The variant's own pictures, 10 at most. */
				images,
				/**
				 * The variant's stock count.
				 * Absent = keep the current count.
				 */
				stock,
			}),
		)
		.default([]),
});
/** A checked `ProductInput`. */
export type ProductInput = z.infer<typeof ProductInput>;

/**
 * Add these categories to these products.
 * POST /products/categories. It is the list's bulk action.
 */
export const ProductCategoriesInput = z.object({
	/** The products to change: 1 to 500. */
	product_ids: z
		.array(z.number().int().positive())
		.min(1, "validation.pick_products")
		.max(PRODUCT_BULK_MAX),
	/** The categories to add: 1 to 200. */
	category_ids: z
		.array(z.number().int().positive())
		.min(1, "validation.pick_categories")
		.max(200),
});
/** A checked `ProductCategoriesInput`. */
export type ProductCategoriesInput = z.infer<typeof ProductCategoriesInput>;
