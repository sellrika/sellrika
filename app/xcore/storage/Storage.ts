import { DriveManager } from "flydrive";
import { FSDriver } from "flydrive/drivers/fs";
import { GCSDriver } from "flydrive/drivers/gcs";
import { S3Driver } from "flydrive/drivers/s3";
import { AzureDriver } from "flydrive-azure";
import { Outbound } from "@xcore/http/Outbound";
import { t } from "@xcore/i18n/I18n";
import { storage } from "@config/storage";
import { STATIC_CACHE_CONTROL } from "@constants/Http.Constant";
import {
	IMAGE_FETCH_TIMEOUT_MS,
	IMAGE_TYPES,
	MAX_IMAGE_DATA_LENGTH,
	MAX_IMAGE_PIXELS,
	MAX_IMAGE_URL_LENGTH,
	MAX_UPLOAD_BYTES,
	ORDER_IMAGE_PREFIX,
	UPLOAD_DIR,
	UPLOAD_IMAGE_PX,
	UPLOAD_WEBP_QUALITY,
	type UploadFolder,
} from "@constants/Storage.Constant";

export { UPLOAD_DIR };

/** The settings of each storage driver. */
const { local, s3, azure, gcs } = storage.drivers;

/**
 * The upload disks (flydrive).
 * `drive.use()` returns the disk `STORAGE_DRIVER` names.
 * A driver is only built on first use,
 * so the other drivers' settings may stay empty.
 * A file's key is its URL path without the first `/`:
 * `uploads/<shop id>/<folder>/<uuid>.<ext>`
 * (older files: `uploads/<uuid>.<ext>`).
 * The same key works on every driver.
 */
export const drive = new DriveManager({
	default: storage.default,
	services: {
		local: () =>
			new FSDriver({
				location: Bun.pathToFileURL(local.dir),
				visibility: "private",
			}),
		s3: () => new S3Driver({ ...s3, visibility: "private" }),
		azure: () => new AzureDriver(azure),
		gcs: () =>
			new GCSDriver({ ...gcs, visibility: "private", usingUniformAcl: true }),
	},
	/** Tests swap a service for a folder-backed fake with `drive.fake(name)`. */
	fakes: { location: Bun.pathToFileURL(`${local.dir}-fake`) },
});

/**
 * Uploaded images: saving, reading, deleting, checking a path,
 * shrinking a picture and fetching one from a link.
 */
export class Storage {
	/**
	 * Make sure the local upload directory exists at boot.
	 * `Bun.write` would create it on the first upload anyway.
	 * Doing it here means a fresh deployment fails loudly now,
	 * not on someone's first save.
	 * @returns The bytes written (0).
	 */
	static ensure() {
		return Bun.write(`${UPLOAD_DIR}/uploads/.keep`, "");
	}

	/**
	 * Save an uploaded image through the storage driver.
	 * @param file The uploaded file.
	 *   Its bytes are sniffed; the client's mime type is ignored.
	 * @param shopId The shop the file belongs to.
	 * @param folder The folder inside the shop's folder.
	 * @returns The public URL path.
	 *   An error message when the file is too big or not an image.
	 */
	static async storeImage(
		file: File,
		shopId: number,
		folder: UploadFolder,
	): Promise<{ url: string } | { error: string }> {
		if (file.size > MAX_UPLOAD_BYTES)
			return { error: t("server.upload_too_large") };
		const url = await Storage.put(
			await Storage.compress(new Uint8Array(await file.arrayBuffer())),
			shopId,
			folder,
		);
		return url ? { url } : { error: t("server.upload_bad_type") };
	}

	/**
	 * Save image bytes through the storage driver under a new name.
	 * @param bytes The file. Sniffed; anything that isn't an image is refused.
	 * @param shopId The shop the file belongs to.
	 * @param folder The folder inside the shop's folder.
	 * @returns The `/uploads/<shop id>/<folder>/<uuid>.<ext>` path.
	 *   Null when the bytes are not an image.
	 */
	static async put(
		bytes: Uint8Array,
		shopId: number,
		folder: UploadFolder,
	): Promise<string | null> {
		const ext = Storage.#sniff(bytes);
		if (!ext) return null;
		const key = `uploads/${shopId}/${folder}/${Bun.randomUUIDv7()}.${ext}`;
		await drive.use().put(key, bytes, { contentType: IMAGE_TYPES[ext] });
		return `/${key}`;
	}

	/**
	 * Copy the picture behind an https link into one of the shop's folders.
	 * A product never keeps a link to another site:
	 * that site may change or remove the picture.
	 * @param url The https link.
	 * @param shopId The shop the picture belongs to.
	 * @param folder The folder inside the shop's folder.
	 * @returns Our `/uploads/…` URL, or an error message.
	 */
	static async storeImageFromUrl(
		url: string,
		shopId: number,
		folder: UploadFolder = "products",
	): Promise<{ url: string } | { error: string }> {
		const r = await Storage.fetchImage(url);
		if ("error" in r) return r;
		const path = await Storage.put(
			await Storage.compress(r.bytes),
			shopId,
			folder,
		);
		return path ? { url: path } : { error: t("server.upload_bad_type") };
	}

	/**
	 * Save a base64 picture into one of the shop's folders.
	 * For callers that have the file but no link to it (the API, the MCP tools).
	 * @param data The picture: a `data:image/…;base64,` URI or plain base64.
	 * @param shopId The shop the picture belongs to.
	 * @param folder The folder inside the shop's folder.
	 * @returns Our `/uploads/…` URL, or an error message.
	 */
	static async storeImageFromData(
		data: string,
		shopId: number,
		folder: UploadFolder = "products",
	): Promise<{ url: string } | { error: string }> {
		const bytes = new Uint8Array(
			Buffer.from(data.slice(data.indexOf(",") + 1), "base64"),
		);
		if (bytes.byteLength > MAX_UPLOAD_BYTES)
			return { error: t("server.upload_too_large") };
		const path = await Storage.put(
			await Storage.compress(bytes),
			shopId,
			folder,
		);
		return path ? { url: path } : { error: t("server.upload_bad_type") };
	}

	/**
	 * Read a stored image back for `GET /uploads/…`.
	 * `UPLOAD_DIR` is always tried first:
	 * images saved before a driver change still sit there,
	 * and for `local` it is the zero-copy path.
	 * Then the driver is asked.
	 * @param url The `/uploads/…` path, already checked by `isUploadUrl`.
	 * @returns A long-cached response, or null when nobody has the file.
	 */
	static async read(url: string): Promise<Response | null> {
		const headers = { "cache-control": STATIC_CACHE_CONTROL };
		const file = Bun.file(`${UPLOAD_DIR}${url}`);
		if (await file.exists()) return new Response(file, { headers });
		const type = IMAGE_TYPES[url.slice(url.lastIndexOf(".") + 1)];
		if (!type) return null;
		const bytes = await Storage.#driverBytes(url);
		return bytes
			? new Response(new Uint8Array(bytes), {
					headers: { ...headers, "content-type": type },
				})
			: null;
	}

	/**
	 * Read one of our uploads as bytes, looked up the same way as `readUpload`:
	 * `UPLOAD_DIR` first, then the storage driver.
	 * @param url A `/uploads/…` path.
	 * @returns The bytes and their mime type.
	 *   Null when the path is not ours or nobody has the file.
	 */
	static async readBytes(
		url: string,
	): Promise<{ bytes: Uint8Array; type: string } | null> {
		if (!Storage.isUploadUrl(url)) return null;
		const type = IMAGE_TYPES[url.slice(url.lastIndexOf(".") + 1)];
		if (!type) return null;
		const file = Bun.file(`${UPLOAD_DIR}${url}`);
		if (await file.exists()) return { bytes: await file.bytes(), type };
		const bytes = await Storage.#driverBytes(url);
		return bytes ? { bytes: new Uint8Array(bytes), type } : null;
	}

	/**
	 * Is this one of our upload paths?
	 * `/uploads/<shop id>/<folder>/<uuid>.<ext>`,
	 * or an older flat `/uploads/<uuid>.<ext>`.
	 * Only digits, `[a-z]` and `[\w-]` pass, so `..` can never get through.
	 * @param s A path.
	 * @returns True for our own upload path.
	 */
	static isUploadUrl(s: string): boolean {
		return /^\/uploads\/(\d+\/[a-z]+\/)?[\w-]+\.(jpg|png|webp|avif|gif)$/.test(
			s,
		);
	}

	/**
	 * Is this a link to a picture hosted elsewhere?
	 * `https://` only, no user:pass, not absurdly long.
	 * Accepted as input only: a product save copies it into our storage
	 * (`storeImageFromUrl`).
	 * @param s The link.
	 * @returns True when the link may be fetched.
	 */
	static isHttpsImageUrl(s: string) {
		if (s.length > MAX_IMAGE_URL_LENGTH) return false;
		try {
			const u = new URL(s);
			return u.protocol === "https:" && !u.username && !u.password;
		} catch {
			return false;
		}
	}

	/**
	 * Download the picture behind an https image link,
	 * so the product form can edit it.
	 * The browser can't read most linked pictures itself:
	 * the other site sends no CORS header.
	 * Only bytes that sniff as an image come back,
	 * so nothing else behind a link is ever shown.
	 * Private and local addresses are refused (`fetchPublic`).
	 * @param url The https link.
	 * @returns The image and its mime type, or an error message.
	 */
	static async fetchImage(
		url: string,
	): Promise<
		{ bytes: Uint8Array<ArrayBuffer>; type: string } | { error: string }
	> {
		if (!Storage.isHttpsImageUrl(url))
			return { error: t("server.image_link_bad") };
		try {
			const got = await Outbound.fetch(
				url,
				{
					signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
					headers: { accept: "image/*" },
				},
				MAX_UPLOAD_BYTES,
			);
			// a private address looks like any failed link
			if (!got?.res.ok) return { error: t("server.image_fetch_failed") };
			const ext = Storage.#sniff(got.bytes);
			return ext
				? { bytes: got.bytes, type: IMAGE_TYPES[ext]! }
				: { error: t("server.upload_bad_type") };
		} catch (e) {
			return {
				error: t(
					e instanceof Error && e.name === "TooLarge"
						? "server.upload_too_large"
						: "server.image_fetch_failed",
				),
			};
		}
	}

	/**
	 * Is this a picture sent as base64 text?
	 * A `data:image/…;base64,` URI or plain base64, not longer than a
	 * `MAX_UPLOAD_BYTES` picture needs.
	 * Only the shape is checked here: the bytes are sniffed when stored
	 * (`storeImageFromData`).
	 * @param s The text.
	 * @returns True when the text may be decoded and stored.
	 */
	static isImageData(s: string) {
		if (s.length > MAX_IMAGE_DATA_LENGTH) return false;
		const m = /^(?:data:image\/[\w.+-]+;base64,)?([A-Za-z0-9+/]+)={0,2}$/.exec(
			s,
		);
		// base64 never leaves one character over
		return !!m && m[1]!.length % 4 !== 1;
	}

	/**
	 * Is this anything a product image may be?
	 * @param s A path, a link or a base64 picture.
	 * @returns True for one of our uploads, an https link or base64.
	 */
	static isImageUrl(s: string) {
		return (
			Storage.isUploadUrl(s) ||
			Storage.isHttpsImageUrl(s) ||
			Storage.isImageData(s)
		);
	}

	/**
	 * Is this an order line's own picture?
	 * `/uploads/<shop id>/orders/…`, or an older `/uploads/order-…`.
	 * These are never shared with products and never deleted with them.
	 * @param url A stored image path.
	 * @returns True for an order picture.
	 */
	static isOrderImage(url: string): boolean {
		return (
			Storage.isUploadUrl(url) &&
			(/^\/uploads\/\d+\/orders\//.test(url) ||
				url.startsWith(`/uploads/${ORDER_IMAGE_PREFIX}`))
		);
	}

	/**
	 * Delete one uploaded file: from the storage driver,
	 * and from `UPLOAD_DIR` where older files still sit.
	 * Never throws: a failure is logged.
	 * The caller checks first that nothing uses the file any more.
	 * Order pictures are refused outright: an order keeps its picture for good.
	 * @param url A `/uploads/…` path.
	 */
	static async delete(url: string): Promise<void> {
		if (!Storage.isUploadUrl(url) || Storage.isOrderImage(url)) return;
		try {
			await drive.use().delete(url.slice(1));
			const file = Bun.file(`${UPLOAD_DIR}${url}`);
			if (await file.exists()) await file.delete();
		} catch (e) {
			console.warn(`[storage] could not delete ${url}:`, e);
		}
	}

	/**
	 * Make an uploaded picture ready to store: WebP, at most
	 * `UPLOAD_IMAGE_PX` on its longest side.
	 * A photo is written at high quality. A PNG is written lossless,
	 * so a logo or a QR code keeps every pixel and its transparency.
	 * Kept as it is: a GIF (it may move), a WebP that is small enough
	 * (a second lossy pass would only cost quality), a picture that can't
	 * be opened, and one that would not get smaller.
	 * @param bytes The picture as it arrived.
	 * @returns The bytes to store.
	 */
	static async compress(bytes: Uint8Array): Promise<Uint8Array> {
		const ext = Storage.#sniff(bytes);
		if (!ext || ext === "gif") return bytes;
		try {
			const limit = { maxPixels: MAX_IMAGE_PIXELS };
			const { width, height } = await new Bun.Image(bytes, limit).metadata();
			const big = Math.max(width, height) > UPLOAD_IMAGE_PX;
			if (ext === "webp" && !big) return bytes;
			const out = await new Bun.Image(bytes, limit)
				.resize(UPLOAD_IMAGE_PX, UPLOAD_IMAGE_PX, {
					fit: "inside",
					withoutEnlargement: true,
				})
				.webp(
					ext === "png" ? { lossless: true } : { quality: UPLOAD_WEBP_QUALITY },
				)
				.bytes();
			return big || out.byteLength < bytes.byteLength ? out : bytes;
		} catch {
			return bytes;
		}
	}

	/**
	 * Shrink a picture to fit a square box.
	 * A PNG stays a PNG (it may be transparent), and so does a WebP that
	 * is transparent. Anything else becomes a JPEG.
	 * When the picture can't be read or written (an old GIF, AVIF off macOS…),
	 * the original is kept.
	 * @param file The picture's bytes and mime type.
	 * @param px The box size, in pixels.
	 * @returns The bytes, mime type and file extension.
	 */
	static async shrink(
		file: { bytes: Uint8Array; type: string },
		px: number,
	): Promise<{ bytes: Uint8Array; type: string; ext: string }> {
		const png =
			file.type === "image/png" ||
			(file.type === "image/webp" && Storage.#webpHasAlpha(file.bytes));
		try {
			const image = new Bun.Image(file.bytes, {
				maxPixels: MAX_IMAGE_PIXELS,
			}).resize(px, px, {
				fit: "inside",
				withoutEnlargement: true,
			});
			const bytes = await (png
				? image.png()
				: image.jpeg({ quality: 80 })
			).bytes();
			return png
				? { bytes, type: "image/png", ext: "png" }
				: { bytes, type: "image/jpeg", ext: "jpg" };
		} catch {
			return { ...file, ext: file.type.slice(file.type.indexOf("/") + 1) };
		}
	}

	/**
	 * Does this WebP file say it is transparent?
	 * Read from its header, no decoding.
	 * @param b The WebP file's bytes.
	 * @returns True when the alpha flag is set.
	 */
	static #webpHasAlpha(b: Uint8Array): boolean {
		const chunk = String.fromCharCode(...b.subarray(12, 16));
		// extended format: the flags byte. Lossless: one bit after the two sizes.
		if (chunk === "VP8X") return (b[20]! & 0x10) !== 0;
		return chunk === "VP8L" && (b[24]! & 0x10) !== 0;
	}

	/**
	 * Detect the image type from the file's first bytes.
	 * The client's mime type is never trusted.
	 * @param b The file's bytes.
	 * @returns The file extension, or null when it is not an image we take.
	 */
	static #sniff(b: Uint8Array): string | null {
		if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
			return "png";
		if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
		if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
			return "gif";
		if (
			b[0] === 0x52 &&
			b[1] === 0x49 &&
			b[2] === 0x46 &&
			b[3] === 0x46 &&
			b[8] === 0x57 &&
			b[9] === 0x45 &&
			b[10] === 0x42 &&
			b[11] === 0x50
		)
			return "webp";
		// AVIF is an ISO-BMFF file: the "ftyp" box at 4, the major brand at 8.
		// The brand is "avif" (still) or "avis" (sequence).
		const brand = String.fromCharCode(...b.subarray(4, 12));
		if (brand === "ftypavif" || brand === "ftypavis") return "avif";
		return null;
	}

	/**
	 * Read a file from the storage driver.
	 * ponytail: whole file in memory, uploads are 5 MB at most.
	 * Use getStream() when bigger files arrive.
	 * @param url The `/uploads/…` path.
	 * @returns The bytes, or null when the driver has no such file.
	 */
	static #driverBytes(url: string) {
		return drive
			.use()
			.getBytes(url.slice(1))
			.catch(() => null);
	}
}
