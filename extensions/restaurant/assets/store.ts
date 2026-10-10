/**
 * The script on the shop's online store (slot `store.page`).
 * The store works only on a table's QR link (`?table=&t=` on the address,
 * kept there while the guest browses; nothing is remembered in the browser).
 * Any other address, or an old code, shows an "Invalid link" notice.
 * The guest orders for that table:
 * the cart's button shows the cart once more, with a note box per dish,
 * then sends it to the kitchen and onto the table's bill, with no checkout.
 * Plain DOM, styled with the theme's own `--store-*` colours.
 */
import type { StoreExtensionApi, StoreScript } from "../../types";
import type { Bill } from "./utils.ts";

/**
 * The table a guest sits at: its name and the signature from the QR link.
 */
type Seat = { table: string; t: string };

/**
 * Everything the script holds.
 */
type State = {
	api: StoreExtensionApi;
	seat: Seat;
	/**
	 * The table's bill as last read, or null before the first answer.
	 */
	bill: Bill | null;
	/**
	 * The bar at the bottom of the page: the table and its bill.
	 */
	bar: HTMLButtonElement;
	/**
	 * The bill dialog and the parts it redraws.
	 */
	dialog: HTMLDialogElement;
	heading: HTMLElement;
	list: HTMLElement;
	total: HTMLElement;
};

/**
 * The guest's table, from the QR link only (`?table=&t=`). Nothing is
 * remembered: a page without both is not a table's page.
 * @returns The seat, or null for a visitor with no table.
 */
function readSeat(): Seat | null {
	const q = new URLSearchParams(location.search);
	const table = q.get("table");
	const t = q.get("t");
	return table && t ? { table, t } : null;
}

/**
 * A store address with the seat on it.
 * @param seat The guest's table.
 * @param href Any address.
 * @returns The same address with `?table=&t=` when it is one of this store, else as it was.
 */
function seated(seat: Seat, href: string) {
	const url = new URL(href, location.href);
	if (url.origin !== location.origin) return href;
	url.searchParams.set("table", seat.table);
	url.searchParams.set("t", seat.t);
	return url.href;
}

/**
 * Keep the seat on the address while the guest browses the store: every
 * link, every search form and the cart's product links carry `?table=&t=`.
 * @param api The storefront api.
 * @param seat The guest's table.
 */
function carrySeat(api: StoreExtensionApi, seat: Seat) {
	document.addEventListener(
		"click",
		function link(e) {
			const a = (e.target as Element | null)?.closest?.("a[href]");
			if (a instanceof HTMLAnchorElement) a.href = seated(seat, a.href);
		},
		true,
	);
	document.addEventListener(
		"submit",
		function form(e) {
			const f = e.target;
			if (!(f instanceof HTMLFormElement) || f.method !== "get") return;
			// a GET form replaces the query: its own fields must name the seat
			for (const [name, value] of Object.entries(seat)) {
				if (f.elements.namedItem(name)) continue;
				const field = document.createElement("input");
				field.type = "hidden";
				field.name = name;
				field.value = value;
				f.append(field);
			}
		},
		true,
	);
	const product = api.store.url.product;
	api.store.url.product = (slug) => seated(seat, product(slug));
}

/** The status the extension's routes answer a wrong or old table code with. */
const REFUSED = 422;

/**
 * Close the store for a visitor with no table: a restaurant takes orders
 * only from a table's QR code. A notice covers the page, and the cart's
 * button sends nothing.
 * @param api The storefront api.
 * @param title The notice's heading.
 */
function block(api: StoreExtensionApi, title: string) {
	const cover = el(
		"div",
		"position:fixed;inset:0;z-index:2147483647;display:grid;place-content:center;justify-items:center;gap:10px;padding:24px;text-align:center;background:var(--store-surface, #fff);color:var(--store-fg, #111);font-family:var(--store-font, inherit)",
	);
	cover.dataset.restaurantBlocked = "";
	cover.setAttribute("role", "alert");
	cover.append(
		el("p", "margin:0;font-size:40px;line-height:1", "▦"),
		el("h1", "margin:0;font-size:20px", title),
		el(
			"p",
			"margin:0;max-width:320px;color:var(--store-muted, #666);font-size:14px",
			api.t("store.scan_body"),
		),
	);
	document.body.append(cover);
	document.documentElement.style.overflow = "hidden";
	api.store.checkout = async () => api.t("store.scan_title");
}

/**
 * Money in the shop's own currency.
 * @param s The state.
 * @param cents The amount.
 * @returns The formatted amount.
 */
function money(s: State, cents: number) {
	return s.api.store.moneyIn(cents, s.api.store.data.store.currency);
}

/**
 * A plain element with inline styles.
 * @param tag The tag name.
 * @param style Its CSS.
 * @param text Its text, if any.
 * @returns The element.
 */
function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	style: string,
	text = "",
) {
	const node = document.createElement(tag);
	node.style.cssText = style;
	node.textContent = text;
	return node;
}

/** The look of the script's dialogs and of their plain buttons, in the theme's colours. */
const DIALOG_STYLE =
	"width:min(420px, calc(100vw - 32px));padding:0;overflow:hidden;border:1px solid var(--store-line);border-radius:var(--store-radius);background:var(--store-surface);color:var(--store-fg);font-family:var(--store-font)";
/** The box inside a dialog: as tall as the screen allows; its list scrolls, what is above and below stays in view. */
const BOX_STYLE =
	"display:flex;flex-direction:column;box-sizing:border-box;max-height:calc(100dvh - 32px);padding:20px";
const SCROLL_STYLE = "flex:1;min-height:0;overflow-y:auto";

/**
 * Put a dialog's parts in its box. The box is a column, so a part with
 * `SCROLL_STYLE` (the list) scrolls and the rest stays where it is.
 * @param dialog The dialog.
 * @param parts Its parts, top to bottom.
 */
function fill(dialog: HTMLDialogElement, ...parts: HTMLElement[]) {
	const box = el("div", BOX_STYLE);
	box.append(...parts);
	dialog.append(box);
}
const BUTTON_STYLE =
	"padding:10px;border:1px solid var(--store-line);border-radius:var(--store-button-radius);background:transparent;color:inherit;font:inherit;cursor:pointer";

/**
 * Draw the bar and the bill dialog from the bill as last read.
 * @param s The state.
 */
function render(s: State) {
	const { api } = s;
	const order = s.bill?.order ?? null;
	const table = api.t("store.table", { table: s.seat.table });
	s.bar.textContent = order
		? `${table} · ${api.t("store.view_bill")} · ${money(s, order.total)}`
		: table;
	const rows = (order?.items ?? []).map(function row(item) {
		const li = el(
			"li",
			"display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--store-line)",
		);
		const name = el("span", "min-width:0", `${item.qty}× ${item.name}`);
		if (item.note)
			name.append(
				el(
					"span",
					"display:block;font-size:12px;color:var(--store-muted)",
					item.note,
				),
			);
		li.append(
			name,
			el("span", "white-space:nowrap", money(s, item.price * item.qty)),
		);
		return li;
	});
	s.list.replaceChildren(
		...(rows.length
			? rows
			: [el("li", "color:var(--store-muted)", api.t("store.empty_bill"))]),
	);
	s.total.textContent = order
		? `${api.t("store.total")}: ${money(s, order.total)}`
		: "";
}

/**
 * Read the table's bill from the server and draw it.
 * A failure leaves what is shown.
 * @param s The state.
 */
async function refresh(s: State) {
	const q = new URLSearchParams(s.seat);
	try {
		const res = await s.api.fetch(`/bill?${q}`);
		if (res.status === REFUSED) {
			// the table's code is old (its bill was paid, or staff made a new one): this seat is over
			s.bar.remove();
			s.dialog.remove();
			block(s.api, s.api.t("store.expired_title"));
			return;
		}
		if (!res.ok) return;
		s.bill = await res.json();
		render(s);
	} catch {
		// offline for a moment: the next send reads it again
	}
}

/**
 * Open the bill dialog.
 * @param s The state.
 * @param heading The line above the list.
 */
function showBill(s: State, heading: string) {
	s.heading.textContent = heading;
	if (!s.dialog.open) s.dialog.showModal();
}

/** The longest note a guest may type for one dish. */
const NOTE_MAX = 200;

/**
 * Send the cart to the table's bill, each line with the note typed for it.
 * @param s The state.
 * @param notes The note of each cart line, by the line's key.
 * @returns Why it failed, or null when the order was sent.
 */
async function send(
	s: State,
	notes: Map<string, string>,
): Promise<string | null> {
	const { api } = s;
	try {
		const res = await api.fetch("/order", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...s.seat,
				items: api.store.cart.lines().map(function item(l) {
					return {
						product_id: l.product_id,
						variant_id: l.variant_id,
						qty: l.qty,
						choices: l.choices ?? {},
						note: (notes.get(l.key) ?? l.note ?? "").trim(),
					};
				}),
			}),
		});
		const answer = await res.json().catch(function none() {
			return {};
		});
		if (!res.ok) return answer.error ?? api.t("store.failed");
		s.bill = answer;
		api.store.cart.clear();
		// the theme's cart drawer and the review are dialogs: close them, then show the bill
		for (const open of Array.from(document.querySelectorAll("dialog[open]")))
			(open as HTMLDialogElement).close();
		render(s);
		showBill(s, api.t("store.sent"));
		return null;
	} catch {
		return api.t("store.failed");
	}
}

/**
 * "Send to kitchen": show the cart once more, each dish with a box for a
 * note to the kitchen ("not spicy"), then send it.
 * It takes the place of `Store.checkout()`, so the theme's cart button calls it.
 * A refusal is shown in the dialog itself.
 * @param s The state.
 */
function review(s: State) {
	const { api } = s;
	const lines = api.store.cart.lines();
	if (!lines.length) return;
	const notes = new Map<string, string>();
	const dialog = el("dialog", DIALOG_STYLE);
	dialog.dataset.restaurantReview = "";
	const list = el(
		"ul",
		`list-style:none;margin:0 0 12px;padding:0;${SCROLL_STYLE}`,
	);
	for (const line of lines) {
		const name = `${line.qty}× ${line.name}${line.variant_name ? ` · ${line.variant_name}` : ""}`;
		const row = el(
			"li",
			"display:grid;gap:6px;padding:10px 0;border-bottom:1px solid var(--store-line)",
		);
		const head = el(
			"div",
			"display:flex;justify-content:space-between;gap:12px;font-size:14px",
		);
		head.append(
			el("span", "min-width:0;font-weight:600", name),
			el("span", "white-space:nowrap", money(s, line.price * line.qty)),
		);
		const box = el(
			"input",
			"width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--store-line);border-radius:var(--store-button-radius);background:transparent;color:inherit;font:inherit;font-size:14px",
		);
		box.maxLength = NOTE_MAX;
		box.value = line.note ?? "";
		box.placeholder = api.t("store.note_placeholder");
		box.setAttribute("aria-label", api.t("store.note_label", { name }));
		box.dataset.restaurantNote = "";
		box.oninput = () => notes.set(line.key, box.value);
		row.append(head, box);
		list.append(row);
	}
	const error = el("p", "margin:0 0 12px;color:#dc2626;font-size:14px");
	error.hidden = true;
	const back = el("button", `${BUTTON_STYLE};flex:1`, api.t("store.back"));
	back.type = "button";
	const go = el(
		"button",
		`${BUTTON_STYLE};flex:2;border-color:var(--store-accent);background:var(--store-accent);color:var(--store-on-accent);font-weight:600`,
		api.t("store.send"),
	);
	go.type = "button";
	back.onclick = () => dialog.close();
	go.onclick = async () => {
		go.disabled = true;
		error.hidden = true;
		const refusal = await send(s, notes);
		if (!refusal) return;
		error.textContent = refusal;
		error.hidden = false;
		go.disabled = false;
	};
	const buttons = el("div", "display:flex;gap:8px");
	buttons.append(back, go);
	fill(
		dialog,
		el("h2", "margin:0 0 4px;font-size:18px", api.t("store.review")),
		el(
			"p",
			"margin:0 0 4px;color:var(--store-muted);font-size:14px",
			api.t("store.review_hint", {
				table: api.t("store.table", { table: s.seat.table }),
			}),
		),
		list,
		error,
		buttons,
	);
	dialog.onclose = () => dialog.remove();
	document.body.append(dialog);
	dialog.showModal();
}

/**
 * Name the theme's cart button "Send to kitchen": there is no checkout
 * for a table. Only its text changes, an icon inside it stays.
 * @param label The new text.
 */
function relabel(label: string) {
	for (const button of Array.from(
		document.querySelectorAll("[data-checkout]"),
	)) {
		const text = Array.from(button.childNodes).find(function words(n) {
			return n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim();
		});
		if (text) text.textContent = ` ${label} `;
		else button.prepend(label);
	}
}

/**
 * Build the bar and the dialog, empty.
 * @param api The storefront api.
 * @param seat The guest's table.
 * @returns The state.
 */
function build(api: StoreExtensionApi, seat: Seat): State {
	const bar = el(
		"button",
		"position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:40;max-width:calc(100vw - 32px);padding:10px 18px;border:0;border-radius:999px;background:var(--store-accent);color:var(--store-on-accent);font:inherit;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgb(0 0 0 / 0.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis",
	);
	bar.type = "button";
	bar.dataset.restaurantBar = "";
	const dialog = el("dialog", DIALOG_STYLE);
	dialog.dataset.restaurantBill = "";
	const heading = el("h2", "margin:0 0 4px;font-size:18px");
	const table = el(
		"p",
		"margin:0 0 12px;color:var(--store-muted);font-size:14px",
		`${api.t("store.table", { table: seat.table })} · ${api.t("store.bill")}`,
	);
	const list = el(
		"ul",
		`list-style:none;margin:0;padding:0;font-size:14px;${SCROLL_STYLE}`,
	);
	const total = el(
		"p",
		"margin:0;padding:12px 0 4px;font-weight:600;text-align:right",
	);
	const note = el(
		"p",
		"margin:0 0 16px;color:var(--store-muted);font-size:13px;text-align:right",
		api.t("store.pay_note"),
	);
	const close = el(
		"button",
		`${BUTTON_STYLE};width:100%`,
		api.t("store.close"),
	);
	close.type = "button";
	close.onclick = () => dialog.close();
	fill(dialog, heading, table, list, total, note, close);
	document.body.append(bar, dialog);
	return { api, seat, bill: null, bar, dialog, heading, list, total };
}

const mount: StoreScript = async (api) => {
	const seat = readSeat();
	if (!seat) return block(api, api.t("store.scan_title"));
	carrySeat(api, seat);
	const s = build(api, seat);
	s.bar.onclick = () => showBill(s, api.t("store.bill"));
	// the review dialog shows a refusal itself: the theme has nothing to show
	api.store.checkout = async () => {
		review(s);
		return null;
	};
	relabel(api.t("store.send"));
	render(s);
	await refresh(s);
};
export default mount;
