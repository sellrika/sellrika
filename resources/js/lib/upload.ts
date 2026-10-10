/** A folder `POST /uploads` accepts (the server's `UPLOAD_FOLDERS`, less `orders`). */
export type UploadFolder =
	| "products"
	| "logo"
	| "pages"
	| "extensions"
	| "payments"
	| "categories";

/**
 * POST one image to /uploads. It lands in `/uploads/<shop id>/<folder>/`.
 * @param file the picture
 * @param folder the folder inside the shop's folder
 * @param shop another shop of the account (a logo on its edit page); the active shop when left out
 * @returns its public URL, or an error message
 */
export async function uploadImage(
	file: File,
	folder: UploadFolder,
	shop?: number,
): Promise<{ url: string } | { error: string }> {
	try {
		const body = new FormData();
		body.append("file", file);
		body.append("folder", folder);
		if (shop) body.append("shop", String(shop));
		const res = await fetch("/uploads", {
			method: "POST",
			body,
			credentials: "same-origin",
		});
		const data: { url: string; errors?: { file?: string } } = await res
			.json()
			.catch(() => ({}));
		return res.ok
			? { url: data.url }
			: { error: data?.errors?.file ?? "Upload failed" };
	} catch {
		return { error: "Upload failed — check your connection." };
	}
}

/**
 * The bytes of an image the editor should open.
 * Our own uploads load directly; an https link goes through
 * POST /uploads/link, because other sites rarely let the browser read their pictures.
 * @param src a picked file, an `/uploads/…` path or an https link
 * @returns the image, or an error message
 */
export async function imageBlob(
	src: File | string,
): Promise<Blob | { error: string }> {
	if (src instanceof File) return src;
	try {
		const res = src.startsWith("/uploads/")
			? await fetch(src, { credentials: "same-origin" })
			: await fetch("/uploads/link", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ url: src }),
					credentials: "same-origin",
				});
		if (res.ok) return await res.blob();
		const data: { errors?: { url?: string } } = await res
			.json()
			.catch(() => ({}));
		return { error: data.errors?.url ?? "Could not load the image" };
	} catch {
		return { error: "Could not load the image — check your connection." };
	}
}
