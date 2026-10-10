import { onMounted, onUnmounted } from "vue";
import { router, usePage } from "@inertiajs/vue3";
import type {
	SearchJSApp,
	SearchJSConfig,
	SearchJSItem,
} from "@bilions/search-js";
import { money } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Key } from "@i18n";
import type { SearchResults, SharedProps } from "@/types";

/**
 * The ⌘K global search (`@bilions/search-js`). Everything here is a registry — add, remove or reorder a line:
 *   - pages(): pages, settings sections and actions matched in the browser
 *   - RECORDS: how each record type `GET /search` answers with is shown (the server registry is SearchService)
 *   (no per-row icons: the published search-js build draws one icon for the whole list)
 *   - ACTIONS: what a picked row does, by name — a row is plain data (it is kept in the recent list), so it
 *     names its action instead of carrying a function; any new kind of action is one more entry here
 */
export type SearchEntry = SearchJSItem & {
	/** Key into ACTIONS. */
	action: string;
	/** Where the action goes (a page, or a POST route). */
	href?: string;
	/** Extra words that should find this row. */
	keywords?: string;
	/** Only admins see it (the server enforces the same on its side). */
	admin?: boolean;
	/** Only managers and admins see it. */
	manager?: boolean;
	/** Only the platform admin (`ADMIN_EMAIL`) sees it: the platform settings. */
	platform?: boolean;
};

export const ACTIONS: Record<string, (e: SearchEntry) => void> = {
	visit: (e) => router.visit(e.href!),
	post: (e) => router.post(e.href!),
};

/** A page (or settings section) you can jump to. `description` doubles as the group name the row shows under its title. */
/** `{shop}` in an href becomes the active shop's id when the row is shown. */
const page = (
	title: string,
	href: string,
	description: string,
	keywords = "",
	admin = false,
): SearchEntry => ({
	title,
	href,
	description,
	keywords,
	admin,
	action: "visit",
});
const setting = (
	title: string,
	href: string,
	description: string,
	keywords = "",
	admin = true,
) => page(title, href, description, keywords, admin);

/**
 * A row for managers and admins (the catalog, payments, reports, staff).
 * @param e The row.
 * @returns The row, open to managers too.
 */
const forManagers = (e: SearchEntry): SearchEntry => ({
	...e,
	admin: false,
	manager: true,
});

/**
 * Everything you can navigate to or do, one line each.
 * Cashiers see the rows without `admin` or `manager`; managers also see the `manager` rows.
 * Built on every search, not once at load: the titles are in the page's language.
 * Keywords stay English and carry a few German words, so both find the row.
 */
export function pages(): SearchEntry[] {
	return [
		page(
			t("nav.sell"),
			"/pos",
			t("nav.sell_desc"),
			"pos checkout cashier sale scan kasse verkauf",
		),
		page(
			t("nav.orders"),
			"/orders",
			t("nav.orders_desc"),
			"receipts history refund void bestellungen belege erstattung",
		),
		page(
			t("nav.unpaid_orders"),
			"/orders?status=unpaid",
			t("nav.unpaid_orders_desc"),
			"cod cash on delivery bank transfer offen unbezahlt nachnahme",
		),
		page(
			t("nav.online_orders"),
			"/orders?source=online",
			t("nav.online_orders_desc"),
			"web shop fulfilment shipping versand online",
		),
		page(
			t("nav.customers"),
			"/customers",
			t("nav.customers_desc"),
			"contacts phone kunden kontakte telefon",
		),
		page(
			t("nav.coupons"),
			"/coupons",
			t("nav.coupons_desc"),
			"promo voucher code gutschein rabatt",
			true,
		),
		forManagers(
			page(
				t("nav.reports"),
				"/reports",
				t("nav.reports_desc"),
				"analytics stats revenue berichte umsatz gewinn",
				true,
			),
		),
		forManagers(
			page(
				t("nav.products"),
				"/products",
				t("nav.products_desc"),
				"items catalogue variants packages produkte katalog varianten",
				true,
			),
		),
		forManagers(
			page(
				t("nav.stock"),
				"/stock",
				t("nav.stock_desc"),
				"inventory low movements bestand lager",
				true,
			),
		),
		forManagers(
			page(
				t("nav.categories"),
				"/categories",
				t("nav.categories_desc"),
				"groups kategorien gruppen",
				true,
			),
		),
		forManagers({
			title: t("nav.new_product"),
			href: "/products/create",
			description: t("nav.new_product_desc"),
			keywords: "create add item neu anlegen produkt",
			admin: true,
			action: "visit",
		}),
		setting(
			t("nav.online_store"),
			"/online-store",
			t("nav.online_store_desc"),
			"web shop slug domain enable onlineshop",
		),
		setting(
			t("nav.store_template"),
			"/online-store?section=template",
			t("nav.store_template_desc"),
			"theme look design vorlage",
		),
		setting(
			t("nav.store_banner"),
			"/online-store?section=content",
			t("nav.store_banner_desc"),
			"announcement phone address hours facebook instagram viber whatsapp support email kontakt banner",
		),
		setting(
			t("nav.store_delivery"),
			"/online-store?section=delivery",
			t("nav.store_delivery_desc"),
			"shipping zones fee price pickup pick up free delivery states cities country address lists lieferung versand abholung",
		),
		setting(
			t("nav.store_gateways"),
			"/online-store?section=payments",
			t("nav.store_gateways_desc"),
			"stripe omise paypal 2c2p cash on delivery bank transfer online payments zahlung",
		),
		setting(
			t("nav.store_alerts"),
			"/online-store?section=alerts",
			t("nav.store_alerts_desc"),
			"telegram email notify notification benachrichtigung",
		),
		setting(
			t("nav.store_pages"),
			"/online-store?section=pages",
			t("nav.store_pages_desc"),
			"about terms privacy faq custom page seiten impressum",
		),
		{
			...setting(
				t("nav.owners"),
				"/owners",
				t("nav.owners_desc"),
				"users benutzer owners shop owners accounts tenants merchants statistics inhaber",
			),
			platform: true,
		},
		{
			...setting(
				t("nav.exchange_rates"),
				"/exchange-rates",
				t("nav.exchange_rates_desc"),
				"currency currencies exchange rates fx convert waehrung wechselkurs",
			),
			platform: true,
		},
		{
			...setting(
				t("nav.postal_codes"),
				"/postal-codes",
				t("nav.postal_codes_desc"),
				"geonames zip postcode states cities address lists download plz staedte adressen",
			),
			platform: true,
		},
		forManagers(
			setting(
				t("nav.payment_methods"),
				"/payment-methods",
				t("nav.payment_methods_desc"),
				"cash card kbz wave pay tendered bargeld karte zahlungsart",
			),
		),
		setting(
			t("online_store.section_currencies"),
			"/online-store?section=currencies",
			t("nav.store_currencies_desc"),
			"currency currencies exchange rate convert switcher waehrung wechselkurs",
		),
		forManagers(
			setting(
				t("nav.staff"),
				"/users",
				t("nav.staff_desc"),
				"users cashier admin team employee mitarbeiter benutzer",
			),
		),
		setting(
			t("nav.shops"),
			"/shops",
			t("nav.shops_desc"),
			"branch store list filiale",
		),
		setting(
			t("nav.edit_shop"),
			"/shops/{shop}/edit",
			t("nav.edit_shop_desc"),
			"rename branch currency timezone logo waehrung zeitzone",
		),
		setting(
			t("nav.extensions"),
			"/extensions",
			t("nav.extensions_desc"),
			"webhook plugin addon install integrations erweiterungen",
		),
		setting(
			t("nav.shop_email"),
			"/shop-email",
			t("nav.shop_email_desc"),
			"smtp resend mail sender outgoing absender",
		),
		setting(
			t("nav.api_keys"),
			"/api-keys",
			t("nav.api_keys_desc"),
			"api key token developer openapi rest mcp ai assistant integration schnittstelle",
		),
		{
			...setting(
				t("nav.global_extensions"),
				"/admin/extensions",
				t("nav.global_extensions_desc"),
				"plugin addon upload zip install built in platform globale erweiterungen",
			),
			platform: true,
		},
		setting(
			t("nav.tax_settings"),
			"/shops/{shop}/edit#tax",
			t("nav.tax_settings_desc"),
			"vat gst rate included tax label steuer mwst",
		),
		{
			title: t("nav.new_shop"),
			href: "/shops/create",
			description: t("nav.new_shop_desc"),
			keywords: "create add branch neuer shop",
			admin: true,
			action: "visit",
		},
		setting(
			t("nav.settings"),
			"/settings",
			t("nav.settings_desc"),
			"account profile name konto profil",
			false,
		),
		setting(
			t("nav.change_password"),
			"/settings",
			t("nav.change_password_desc"),
			"password security passwort",
			false,
		),
		setting(
			t("nav.receipt_printing"),
			"/settings?section=printing",
			t("nav.receipt_printing_desc"),
			"rawbt printer receipt print drucker beleg",
			false,
		),
		{
			...setting(
				t("nav.outgoing_email"),
				"/email",
				t("nav.outgoing_email_desc"),
				"smtp resend mail sender outgoing absender",
			),
			platform: true,
		},
		{
			title: t("nav.logout"),
			href: "/logout",
			description: t("nav.logout_desc"),
			keywords: "sign out exit abmelden",
			action: "post",
		},
	];
}

/** How each record type from `GET /search` is shown and what picking one does. Keys = SearchService's providers. */
export const RECORDS: Record<
	keyof SearchResults,
	{ label: Key; action: string }
> = {
	orders: { label: "nav.record_order", action: "visit" },
	customers: { label: "nav.record_customer", action: "visit" },
	products: { label: "nav.record_product", action: "visit" },
	coupons: { label: "nav.record_coupon", action: "visit" },
	categories: { label: "nav.record_category", action: "visit" },
	staff: { label: "nav.record_staff", action: "visit" },
	shops: { label: "nav.record_shop", action: "post" }, // the href is the switch route
};

/** Every word typed must appear somewhere in the row (title, description or keywords), any case. */
export function matches(e: SearchEntry, keyword: string): boolean {
	const hay =
		`${e.title} ${e.description ?? ""} ${e.keywords ?? ""}`.toLowerCase();
	return keyword
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every((w) => hay.includes(w));
}

/**
 * Text from a record, made safe to show.
 * search-js writes a row's title and description as HTML.
 * @param text The plain text, like a customer's name.
 * @returns The text with its HTML characters encoded.
 */
export function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, function encode(c) {
		return `&#${c.charCodeAt(0)};`;
	});
}

/**
 * The server's hits as rows: "<Type> · <subtitle> · <amount>" under the title.
 * Titles and subtitles are text people typed (a buyer's name), so they are escaped.
 */
export function recordEntries(
	results: SearchResults,
	currency: string,
): SearchEntry[] {
	return (Object.keys(RECORDS) as (keyof SearchResults)[]).flatMap((key) =>
		(results[key] ?? []).map((h) => ({
			title: escapeHtml(h.title),
			description: [
				t(RECORDS[key].label),
				escapeHtml(h.subtitle),
				h.amount != null ? money(h.amount, currency) : "",
			]
				.filter(Boolean)
				.join(" · "),
			href: h.href,
			action: RECORDS[key].action,
		})),
	);
}

/** The mounted palette — `borrowSearch()` lends it to extensions. */
let palette: SearchJSApp | null = null;
/** The download of the package, once it was asked for. */
let mounting: Promise<SearchJSApp> | null = null;

/**
 * Download search-js and mount the palette, once.
 * The package is not part of any page's first load:
 * it comes with the first ⌘K, click on the Search box or `api.search`.
 * The recent picks it keeps in localStorage still work,
 * because every row names its action instead of holding a function.
 * @returns The mounted palette (search-js is a singleton on the page).
 */
function mountPalette(): Promise<SearchJSApp> {
	mounting ??= import("@bilions/search-js").then(mount);
	return mounting;
}

/**
 * Open the palette, downloading it first when needed.
 */
async function openPalette() {
	(await mountPalette()).open();
}

/**
 * ⌘K / Ctrl+K before the package is there.
 * Once mounted, the package handles the keys itself (Esc too).
 * @param e The key press.
 */
function onShortcut(e: KeyboardEvent) {
	if (!palette && e.key === "k" && (e.metaKey || e.ctrlKey)) void openPalette();
}

/**
 * Listen for ⌘K while the layout is on the page.
 * @returns `open()` for the sidebar's Search box.
 */
export function useGlobalSearch() {
	let stopVisits = function none() {};
	onMounted(function listen() {
		window.addEventListener("keydown", onShortcut);
		stopVisits = router.on("before", onVisit);
	});
	onUnmounted(function unlisten() {
		window.removeEventListener("keydown", onShortcut);
		stopVisits();
	});
	return { open: openPalette };
}

/**
 * Create the palette with the app's rows and actions.
 * @param module The downloaded package.
 * @returns The palette.
 */
function mount(module: typeof import("@bilions/search-js")): SearchJSApp {
	const page = usePage<SharedProps>();
	keepPicksOf(page.props.auth.user?.id);
	let app: SearchJSApp | null = null;
	const search = async (keyword: string): Promise<SearchEntry[]> => {
		const admin = page.props.auth.user?.role === "admin";
		const manager = admin || page.props.auth.user?.role === "manager";
		const platform = !!page.props.auth.user?.platform;
		const shopId = String(page.props.shop?.id ?? "");
		const local = pages()
			.filter(
				(e) =>
					(!e.admin || admin) &&
					(!e.manager || manager) &&
					(!e.platform || platform) &&
					matches(e, keyword),
			)
			.map((e) => ({ ...e, href: e.href?.replaceAll("{shop}", shopId) }));
		let remote: SearchEntry[] = [];
		try {
			const res = await fetch(`/search?q=${encodeURIComponent(keyword)}`, {
				headers: { Accept: "application/json" },
			});
			if (res.ok)
				remote = recordEntries(
					await res.json(),
					page.props.shop?.currency ?? "USD",
				);
		} catch {
			/* offline — the pages still answer */
		}
		return [...local, ...remote];
	};
	app = module.default({
		width: "640px",
		positionTop: "12vh",
		theme: "currentColor", // the app's own tokens re-skin it (resources/css/app.css › ⌘K palette)
		onSearchDelay: 200,
		search: { placeholder: t("nav.search_placeholder") },
		onSearch: search,
		onSelected: (item) => {
			app?.close();
			// the package keeps the typed text; start the next search clean (an empty box shows the recent picks)
			const box = document.querySelector<HTMLInputElement>(
				"#search-js .search-input",
			);
			if (box) {
				box.value = "";
				box.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
			}
			ACTIONS[(item as SearchEntry).action]?.(item as SearchEntry);
		},
	});
	palette = app;
	keyboardNavigation();
	return app;
}

const HISTORY = "search-js-histories"; // the package's recent-picks key
const OWNER = "search-js-owner"; // the user id the recent picks belong to

/**
 * Keep the recent picks only for the user who made them.
 * Another user on this browser starts with an empty list.
 * So does a browser with picks from before this rule:
 * those may hold raw HTML.
 * It must run before the palette is created, which draws the list.
 * @param userId The signed-in user's id.
 */
function keepPicksOf(userId: number | undefined) {
	try {
		if (localStorage.getItem(OWNER) === String(userId)) return;
		localStorage.removeItem(HISTORY);
		localStorage.setItem(OWNER, String(userId));
	} catch {
		/* no storage — nothing kept anyway */
	}
}

/**
 * Forget the recent picks when the user logs out.
 * @param event Inertia's `before` event of a visit.
 */
function onVisit(event: { detail: { visit: { url: URL } } }) {
	if (event.detail.visit.url.pathname !== "/logout") return;
	try {
		localStorage.removeItem(HISTORY);
	} catch {
		/* no storage — nothing kept anyway */
	}
}
const BORROWED = "is-borrowed"; // on #search-js while lent: app.css hides the recent picks

export type BorrowedSearch<T extends SearchJSItem = SearchJSItem> = {
	placeholder?: string;
	/** Typed into the box on open and searched at once (a remembered search, something to show before typing). */
	keyword?: string;
	/** Answers each keystroke (after the palette's own delay). `title` / `description` are rendered as HTML; a row's `icon` (HTML) replaces the list's icon on that row. */
	onSearch: (keyword: string) => T[] | Promise<T[]>;
	onSelected: (item: T) => void;
};

/**
 * Lend the ⌘K palette (search-js is one instance per page) to someone else — an extension's picker: its callbacks
 * and placeholder are swapped in and the palette opened; everything is put back when it closes — by a pick, Escape,
 * the backdrop or the returned `close()`; `closed` resolves with what the box held then. The pick is not kept in the
 * palette's recent list.
 * The palette is downloaded first when nobody opened it yet; `close()` before it arrives cancels the loan.
 */
export function borrowSearch<T extends SearchJSItem>(
	opts: BorrowedSearch<T>,
): { close: () => void; closed: Promise<string> } {
	if (palette) return lend(palette, opts);
	let lent: ReturnType<typeof lend> | null = null;
	let cancelled = false;
	/**
	 * Lend the palette once it is mounted.
	 * @returns What the box held when it closed.
	 */
	async function whenMounted() {
		const app = await mountPalette();
		if (cancelled) return "";
		lent = lend(app, opts);
		return lent.closed;
	}
	/** Close the palette, or give up the loan that has not started. */
	function close() {
		cancelled = true;
		lent?.close();
	}
	return { close, closed: whenMounted() };
}

/**
 * Swap the borrower's callbacks into the mounted palette and open it.
 * @param app The mounted palette.
 * @param opts The borrower's callbacks and placeholder.
 * @returns `close()` and `closed`, like `borrowSearch()`.
 */
function lend<T extends SearchJSItem>(
	app: SearchJSApp,
	opts: BorrowedSearch<T>,
): { close: () => void; closed: Promise<string> } {
	const root = document.getElementById("search-js");
	const box = root?.querySelector<HTMLInputElement>(".search-input");
	if (!root || !box) throw new Error("The search palette is not on this page");
	const was = {
		onSearch: app.config.onSearch,
		onSelected: app.config.onSelected,
		placeholder: box.placeholder,
	};
	let done!: (typed: string) => void;
	const closed = new Promise<string>((r) => (done = r));
	const type = (value: string) => {
		box.value = value;
		box.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true })); // the package searches on keyup; empty = its recent picks
	};
	// search-js draws one icon for the whole list; a row's own `icon` is painted over it after every render
	const result = root.querySelector("#search-js-result")!;
	const paint = () => {
		for (const row of Array.from(
			result.querySelectorAll<HTMLElement>(".item"),
		)) {
			const slot = row.querySelector<HTMLElement>(".item-icon");
			const payload = row.getAttribute("data-payload");
			if (!slot || !payload || slot.dataset.own) continue;
			try {
				const { icon } = JSON.parse(unescape(atob(payload))) as {
					icon?: unknown;
				}; // the package's own encoding
				if (typeof icon === "string") {
					slot.innerHTML = icon;
					slot.dataset.own = "1";
				}
			} catch {
				/* not ours */
			}
		}
	};
	const icons = new MutationObserver(paint);
	icons.observe(result, { childList: true });
	const close = () => {
		const typed = box.value;
		icons.disconnect();
		app.config.onSearch = was.onSearch;
		app.config.onSelected = was.onSelected;
		box.placeholder = was.placeholder;
		root.classList.remove(BORROWED);
		delete (app as { close?: () => void }).close; // back to the prototype's
		type("");
		app.close();
		done(typed);
	};
	app.config.onSearch = opts.onSearch as SearchJSConfig["onSearch"];
	app.config.onSelected = (item) => {
		forget(item);
		close();
		opts.onSelected(item as T);
	};
	if (opts.placeholder) box.placeholder = opts.placeholder;
	root.classList.add(BORROWED);
	(app as { close: () => void }).close = close; // Escape and the backdrop call the instance's close
	app.open();
	if (opts.keyword) type(opts.keyword);
	return { close, closed };
}

/** Drop one row from the palette's recent picks (the package adds it before calling onSelected). */
function forget(item: SearchJSItem) {
	try {
		const key = JSON.stringify(item);
		const list = JSON.parse(
			localStorage.getItem(HISTORY) ?? "[]",
		) as SearchJSItem[];
		localStorage.setItem(
			HISTORY,
			JSON.stringify(list.filter((x) => JSON.stringify(x) !== key)),
		);
	} catch {
		/* no storage — nothing kept anyway */
	}
}

/** The row the arrow keys point at (styled like hover in app.css). */
const ACTIVE = "is-active";
/**
 * ↑ / ↓ move through the rows on show (recent picks or results), Enter picks the pointed one (the first when
 * none is). search-js itself only knows clicks; it also re-searches on every keyup, so those keys are kept
 * from it — else the list would re-render and lose the pointer.
 * ponytail: lives here until search-js grows arrow keys; then delete this.
 */
function keyboardNavigation() {
	const root = document.getElementById("search-js");
	const box = root?.querySelector<HTMLInputElement>(".search-input");
	if (!root || !box) return;
	const KEYS = ["ArrowDown", "ArrowUp", "Enter"];
	const rows = () =>
		Array.from(
			root.querySelectorAll<HTMLElement>(".modal-content .item"),
		).filter((el) => el.offsetParent !== null);
	box.addEventListener("keydown", (e) => {
		if (!KEYS.includes(e.key)) return;
		const items = rows();
		if (!items.length) return;
		e.preventDefault();
		const at = items.findIndex((el) => el.classList.contains(ACTIVE));
		if (e.key === "Enter") return (items[at] ?? items[0])!.click();
		const next =
			e.key === "ArrowDown"
				? (at + 1) % items.length
				: (at - 1 + items.length) % items.length;
		for (const el of items) el.classList.remove(ACTIVE);
		items[next]!.classList.add(ACTIVE);
		items[next]!.scrollIntoView({ block: "nearest" });
	});
	// capture on window runs before the package's keyup listener on the box
	window.addEventListener(
		"keyup",
		(e) =>
			e.target === box && KEYS.includes(e.key) && e.stopImmediatePropagation(),
		true,
	);
}
