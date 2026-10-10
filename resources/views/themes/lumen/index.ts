/**
 * The Lumen theme's templates, as text.
 * Imported this way so they are inside the compiled binary.
 * `app/xcore/view/StoreView.ts` registers each one as `themes/lumen/<file>`.
 * A new .edge file in this folder must be added here too.
 */
import account from "./account.edge" with { type: "text" };
import addressForm from "./address-form.edge" with { type: "text" };
import card from "./card.edge" with { type: "text" };
import home from "./home.edge" with { type: "text" };
import icon from "./icon.edge" with { type: "text" };
import layout from "./layout.edge" with { type: "text" };
import notFound from "./not-found.edge" with { type: "text" };
import order from "./order.edge" with { type: "text" };
import page from "./page.edge" with { type: "text" };
import product from "./product.edge" with { type: "text" };
import track from "./track.edge" with { type: "text" };
import unsubscribe from "./unsubscribe.edge" with { type: "text" };

export default {
	account,
	"address-form": addressForm,
	card,
	home,
	icon,
	layout,
	"not-found": notFound,
	order,
	page,
	product,
	track,
	unsubscribe,
} satisfies Record<string, string>;
