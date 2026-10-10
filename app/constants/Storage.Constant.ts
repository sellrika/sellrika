/**
 * Where uploaded images live and how big they may be.
 * See `app/xcore/storage/Storage.ts`.
 */

/**
 * The `local` driver's root folder.
 * Files sit at `<UPLOAD_DIR>/uploads/<shop id>/<folder>/…`,
 * the same key every other driver uses.
 * Tests override the env var so they never touch real uploads.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "storage";

/** Largest image a merchant may upload. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * The longest side of a stored picture, in pixels.
 * A bigger upload is made smaller. A page never shows one wider than this.
 */
export const UPLOAD_IMAGE_PX = 1600;

/**
 * WebP quality (1–100) for a stored photo.
 * High, so the eye sees no difference from the original.
 */
export const UPLOAD_WEBP_QUALITY = 90;

/**
 * The most pixels (width × height) a picture may claim before we open it.
 * A tiny file can claim a huge canvas, and opening it would eat memory.
 * 50 million covers a 48 megapixel phone photo.
 */
export const MAX_IMAGE_PIXELS = 50_000_000;

/** How long `POST /uploads/link` waits for a linked image before giving up. */
export const IMAGE_FETCH_TIMEOUT_MS = 10_000;

/**
 * Longest https image link a product may point at.
 * Browsers and CDNs stop well before this.
 */
export const MAX_IMAGE_URL_LENGTH = 2048;

/**
 * Longest base64 picture a product save takes, in characters.
 * Base64 writes 3 bytes as 4 characters, so this is `MAX_UPLOAD_BYTES`
 * of picture plus room for a `data:image/…;base64,` start.
 */
export const MAX_IMAGE_DATA_LENGTH = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 64;

/**
 * Mime type per stored extension.
 * `sniff()` picks the extension from the bytes.
 * `readUpload()` sends the type back.
 */
export const IMAGE_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
};

/**
 * The folders inside a shop's upload folder:
 * `/uploads/<shop id>/<folder>/<uuid>.<ext>`.
 * `POST /uploads` takes one of these.
 * `orders` is only written by the checkout.
 */
export const UPLOAD_FOLDERS = [
	"products",
	"logo",
	"pages",
	"extensions",
	"payments",
	"categories",
	"orders",
] as const;

/** One of `UPLOAD_FOLDERS`. */
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

/**
 * The name prefix of an older order line's own picture
 * (`/uploads/order-<uuid>.<ext>`).
 * New ones sit in the shop's `orders` folder.
 * Kept so the old files are still known as order pictures.
 */
export const ORDER_IMAGE_PREFIX = "order-";

/**
 * The square box an order line's own picture is shrunk to fit, in pixels.
 * It is only a thumbnail (shown at 40–52 px), so it is stored small.
 */
export const ORDER_IMAGE_PX = 224;

/**
 * How many product pictures keep their order copy in memory.
 * The same picture sold again uses the copy made before.
 * When the list is full the oldest entry goes.
 */
export const ORDER_IMAGE_CACHE_MAX = 500;
