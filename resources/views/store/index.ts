/**
 * The shared store templates, imported as text.
 * Imported, not read from disk, so they are inside the compiled binary.
 * Registered as `store/<key>` by app/xcore/view/StoreView.ts.
 * A new shared .edge file needs a line here.
 */
import document from "./document.edge" with { type: "text" };
import checkout from "./checkout.edge" with { type: "text" };
import done from "./done.edge" with { type: "text" };
import head from "./partials/head.edge" with { type: "text" };
import order from "./partials/order.edge" with { type: "text" };
import address from "./partials/address.edge" with { type: "text" };

export default {
	document,
	checkout,
	done,
	"partials/head": head,
	"partials/order": order,
	"partials/address": address,
} satisfies Record<string, string>;
