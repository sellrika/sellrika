/** Every photo of a product for a gallery: the chosen unit's first (so its cover leads), then the product's,
 * then each variant's — deduplicated, so switching variants only reorders the strip. */
export const galleryOf = (
	product: { images: string[]; variants?: { images: string[] }[] },
	chosen?: { images: string[] } | null,
): string[] => [
	...new Set([
		...(chosen?.images ?? []),
		...product.images,
		...(product.variants ?? []).flatMap((v) => v.images),
	]),
];
