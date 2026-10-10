/**
 * Every built-in store theme's templates, by theme name.
 * Each theme folder's `index.ts` default-exports `{ "<file>": text }`
 * of its .edge files (the file name without ".edge", e.g. "layout", "card").
 * Registered as `themes/<name>/<file>` by app/xcore/view/StoreView.ts.
 * The keys match STORE_TEMPLATES in app/constants/Store.Constant.ts.
 */
import classic from "./classic/index.ts";
import minimal from "./minimal/index.ts";
import boutique from "./boutique/index.ts";
import noir from "./noir/index.ts";
import soft from "./soft/index.ts";
import lumen from "./lumen/index.ts";

export default {
	classic,
	minimal,
	boutique,
	noir,
	soft,
	lumen,
} satisfies Record<string, Record<string, string>>;
