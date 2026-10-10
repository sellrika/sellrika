import { z } from "zod";
import { Storage } from "@xcore/storage/Storage";

/**
 * A category's name and its colour.
 * POST /categories and PUT /categories/:id.
 * The REST API uses it too (`/api/v1/categories`).
 */
export const CategoryInput = z.object({
	/** The category's name. Needed, at most 100 characters. */
	name: z.string().trim().min(1, "validation.name_required").max(100),
	/** The colour as `#rrggbb`. null = no colour. */
	color: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, "validation.pick_valid_color")
		.nullable()
		.default(null),
	/**
	 * The category's picture. null = none.
	 * A save swaps a link or base64 for our own upload.
	 */
	image: z
		.string()
		.refine((s) => Storage.isImageUrl(s), "validation.invalid_image")
		.nullable()
		.default(null)
		.describe(
			"The picture: an https:// link, the picture itself as base64 (a data:image/…;base64, URI or plain base64, 5 MB at most), or the /uploads/… path the category already has. A link or base64 is saved into our storage. null = no picture.",
		),
});
/** A checked `CategoryInput`. */
export type CategoryInput = z.infer<typeof CategoryInput>;
