import type { GuideTopic } from "@constants/Guide.Constant";
import overview from "./overview.md" with { type: "text" };
import selling from "./selling.md" with { type: "text" };
import orders from "./orders.md" with { type: "text" };
import customers from "./customers.md" with { type: "text" };
import coupons from "./coupons.md" with { type: "text" };
import marketing from "./marketing.md" with { type: "text" };
import reports from "./reports.md" with { type: "text" };
import products from "./products.md" with { type: "text" };
import stock from "./stock.md" with { type: "text" };
import onlineStore from "./online-store.md" with { type: "text" };
import storeCheckout from "./store-checkout.md" with { type: "text" };
import staff from "./staff.md" with { type: "text" };
import settings from "./settings.md" with { type: "text" };

/**
 * The user guide's texts, by topic.
 * A static list of imports, so the files are bundled into the compiled binary.
 * Each file starts with its title: `# Title`.
 */
export const guides: Record<GuideTopic, string> = {
	overview,
	selling,
	orders,
	customers,
	coupons,
	marketing,
	reports,
	products,
	stock,
	"online-store": onlineStore,
	"store-checkout": storeCheckout,
	staff,
	settings,
};

/**
 * The title of a guide: its first line without the `# `.
 * @param text The guide's markdown.
 * @returns The title.
 */
export function guideTitle(text: string) {
	return (text.split("\n", 1)[0] ?? "").replace(/^#\s*/, "").trim();
}
