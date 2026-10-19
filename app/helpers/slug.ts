/**
 * Make a URL slug from a name: "Corner Coffee!" → "corner-coffee".
 * Non-latin names can come out empty. Callers must fall back.
 * It cuts first and trims the dashes after, so it never ends in "-".
 * @param name The name.
 * @returns The slug, 50 characters at most.
 */
export function slugify(name: string) {
	return name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, 50)
		.replace(/^-+|-+$/g, "");
}
