import { Guard } from "@xcore/auth/Guard";
import { Compress } from "@xcore/http/Compress";
import { router } from "@xcore/http/Router";
import { Storage } from "@xcore/storage/Storage";
import { UploadController } from "@controllers/Upload.Controller";
import { APPLE_ICON_PATH, FAVICON_16_PATH, FAVICON_32_PATH, FAVICON_48_PATH, FAVICON_96_PATH, FAVICON_144_PATH, FAVICON_CACHE_CONTROL, FAVICON_PATH, FAVICON_SVG_PATH, ICON_192_PATH, ICON_512_PATH, SHARE_IMAGE_PATH, STATIC_CACHE_CONTROL } from "@constants/Http.Constant";
// embedded at compile time, so it works inside the single binary
import ico from "@resources/images/favicon.ico" with { type: "file" };
import svg from "@resources/images/favicon.svg" with { type: "file" };
import png16 from "@resources/images/favicon-16x16.png" with { type: "file" };
import png32 from "@resources/images/favicon-32x32.png" with { type: "file" };
import png48 from "@resources/images/favicon-48x48.png" with { type: "file" };
import png96 from "@resources/images/favicon-96x96.png" with { type: "file" };
import png144 from "@resources/images/favicon-144x144.png" with { type: "file" };
import apple from "@resources/images/apple-touch-icon.png" with { type: "file" };
import png192 from "@resources/images/android-chrome-192x192.png" with { type: "file" };
import png512 from "@resources/images/android-chrome-512x512.png" with { type: "file" };
import share from "@resources/images/og.jpg" with { type: "file" };
import { limit } from "./limits";
import { app } from "@config/app";

/**
 * Files: image uploads (managers and admins) and the static files.
 * Uploaded images come from the storage driver,
 * the built frontend from `public/build`.
 */

/**
 * Cache forever. Build files are content-hashed and uploads UUID-named,
 * so a URL is never re-used for other bytes.
 */
const STATIC_HEADERS = { "cache-control": STATIC_CACHE_CONTROL };

/**
 * The app's own icon files:
 * the address each is served at → the embedded file.
 * Icon lookups (a browser, a phone's home screen, an MCP client)
 * can't read a data URI.
 */
const ICONS: Record<string, string> = {
	[FAVICON_PATH]: ico,
	[FAVICON_SVG_PATH]: svg,
	[FAVICON_16_PATH]: png16,
	[FAVICON_32_PATH]: png32,
	[FAVICON_48_PATH]: png48,
	[FAVICON_96_PATH]: png96,
	[FAVICON_144_PATH]: png144,
	[APPLE_ICON_PATH]: apple,
	[ICON_192_PATH]: png192,
	[ICON_512_PATH]: png512,
	[SHARE_IMAGE_PATH]: share,
};

/** The content type of each kind of icon file. */
const ICON_TYPES: Record<string, string> = {
	ico: "image/x-icon",
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
};

/**
 * GET /favicon.ico, the PNG icons and /og.jpg —
 * the app's icon and its share picture.
 * @param req The current request.
 * @returns The icon file, kept one day.
 */
function icon(req: Request) {
	const path = new URL(req.url).pathname;
	return new Response(Bun.file(ICONS[path]!), {
		headers: {
			"content-type": ICON_TYPES[path.split(".").pop()!]!,
			"cache-control": FAVICON_CACHE_CONTROL,
		},
	});
}

/**
 * GET /uploads/* — an uploaded image.
 * Only our own path shape is served:
 * `<shop id>/<folder>/<file>` or an older bare `<file>`, never `..`.
 * @param req The current request.
 * @returns The image, or a 404.
 */
async function serveUpload(req: Request) {
	const path = new URL(req.url).pathname;
	const res = Storage.isUploadUrl(path) ? await Storage.read(path) : null;
	return res ?? new Response("Not found", { status: 404 });
}

/**
 * GET /build/* — a file of the built frontend.
 * It is gzipped once per file and kept:
 * the router would otherwise re-gzip the same script on every visit.
 * @param req The current request.
 * @returns The file, or a 404.
 */
async function serveBuild(req: Request) {
	const path = new URL(req.url).pathname;
	// one spelling per file: `//` names the same file again, and would fill the gzip cache
	if (path.includes("//")) return new Response("Not found", { status: 404 });
	const file = Bun.file(`${app.buildDir}${path.slice("/build".length)}`);
	return (await file.exists()) ? Compress.gzip(req, new Response(file, { headers: STATIC_HEADERS }), path) : new Response("Not found", { status: 404 });
}

/** Image uploads. Inside `auth`, `manager`, then the `upload` limit. */
function uploadRoutes() {
	router.post("/uploads", [UploadController, "store"]);
	router.post("/uploads/link", [UploadController, "link"]);
}

/** The upload routes and the static files. */
export function fileRoutes() {
	router.group([Guard.auth, Guard.manager, limit("upload")], uploadRoutes);
	router.get("/uploads/*", serveUpload);
	for (const path of Object.keys(ICONS)) router.get(path, icon);
	router.get("/build/*", serveBuild);
}
