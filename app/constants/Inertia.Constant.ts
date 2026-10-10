/**
 * Asset entry points and the default tab icon.
 * Everything `app/xcore/view/Inertia.ts` hard-codes.
 */

import { FAVICON_PATH } from "./Http.Constant";

/**
 * Vite's client entry.
 * Also the key `public/build/.vite/manifest.json` is looked up by.
 */
export const VITE_ENTRY = "resources/js/app.ts";

/** Dev only — in production the manifest lists the built CSS. */
export const VITE_CSS_ENTRY = "resources/css/app.css";

/**
 * Default tab icon: the Sellrika mark, as a real file.
 * A data URI works in a browser tab.
 * But tools that look up a site's icon can't use one.
 * Public stores pass their own logo instead.
 */
export const DEFAULT_FAVICON = FAVICON_PATH;
