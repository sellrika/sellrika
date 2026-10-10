/**
 * Response tuning.
 * What the router compresses,
 * and how long the browser may keep a static file.
 */

/**
 * How long the browser keeps a static file: a year.
 * Vite names build files by content hash and uploads by UUID.
 * So a URL never changes its bytes.
 */
export const STATIC_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Where the app's own icon is served, on every host.
 * Tools that look up a site's icon ask for this path
 * (an MCP client, a search engine).
 */
export const FAVICON_PATH = "/favicon.ico";

/** The icon as an SVG file: sharp at every size. */
export const FAVICON_SVG_PATH = "/favicon.svg";

/**
 * The same icon as PNG files, served on every host too.
 * The page head links the small ones.
 * The MCP server names the two big ones.
 * This one is 16 px.
 */
export const FAVICON_16_PATH = "/favicon-16x16.png";

/** The 32 px icon. */
export const FAVICON_32_PATH = "/favicon-32x32.png";

/**
 * The 48 px icon.
 * Google Search asks for an icon of at least 48 px.
 */
export const FAVICON_48_PATH = "/favicon-48x48.png";

/** The 96 px icon. */
export const FAVICON_96_PATH = "/favicon-96x96.png";

/** The 144 px icon. */
export const FAVICON_144_PATH = "/favicon-144x144.png";

/** The icon for Apple devices. */
export const APPLE_ICON_PATH = "/apple-touch-icon.png";

/** The 192 px icon. */
export const ICON_192_PATH = "/android-chrome-192x192.png";

/** The 512 px icon. */
export const ICON_512_PATH = "/android-chrome-512x512.png";

/**
 * The picture a shared link of the app's own pages shows.
 * 1200 × 630, the size X and Facebook ask for.
 */
export const SHARE_IMAGE_PATH = "/og.jpg";

/**
 * How long the browser keeps the icons: one day only.
 * The icons keep their address when the logo changes.
 */
export const FAVICON_CACHE_CONTROL = "public, max-age=86400";

/**
 * How long a crawler may keep `/sitemap.xml` and `/robots.txt`: one hour.
 * Crawlers ask for them often, and a sitemap reads the whole catalog.
 */
export const SEO_CACHE_CONTROL = "public, max-age=3600";

/**
 * How long the browser keeps an extension's file in production: one hour.
 * Its URL carries only the manifest version, not a content hash.
 * So a file changed without a new version is stale for an hour at most.
 */
export const EXTENSION_ASSET_CACHE_CONTROL = "public, max-age=3600";

/**
 * Bodies smaller than this are not gzipped.
 * They fit one packet anyway.
 * gzip would only add CPU and a header.
 */
export const COMPRESS_MIN_BYTES = 1024;

/**
 * The most gzipped build files kept in memory.
 * A build has a few hundred files. Past this, a file is gzipped on each request.
 */
export const COMPRESS_CACHE_MAX = 1000;

/**
 * Text-like bodies worth gzipping, and wasm (it shrinks a lot).
 * Images, fonts and zips are already compressed.
 */
export const COMPRESSIBLE_TYPES =
	/^(text\/|application\/(javascript|json|xml|manifest\+json|wasm)|image\/svg\+xml)/;
