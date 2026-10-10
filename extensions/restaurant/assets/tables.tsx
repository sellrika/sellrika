/**
 * The "Tables" page, named in the manifest's `pages` (sidebar › Sales).
 * The app's page around it gives the title and the padding.
 * At the top: Add tables (managers and admins: a name, `5`, or `1-30`) and
 * the day's numbers (unpaid total, open bills, free tables, QR codes ready).
 * Then the tables as tiles, filtered by All / Open bill / Free, and a side
 * panel for the selected one: its bill (each line with a remove button: a
 * draft on screen until Save changes),
 * Add items and Pay, its QR code
 * (New QR code prints it at once, Print QR again) and Remove table.
 * It asks the server again every 30 seconds.
 * JSX here is plain DOM, see ../../README.md › JSX.
 */
import type { Api, PageScript } from "../../types";
import type { TableRow, TablesAnswer } from "./utils.ts";
import { TableTile } from "./components/TableTile.tsx";
import { type PanelTab, TablePanel } from "./components/TablePanel.tsx";
import { withIcon } from "./components/icons.ts";
import { MoveBody, type MoveMode } from "./components/MoveBody.tsx";
import { DiscountBox, PayBody, PaySums } from "./components/PayBody.tsx";

/** The id of the "Add tables" box, for its label. */
const ADD_ID = "restaurant-add-tables";
/** How often the page asks the server again (open times, new bills). */
const REFRESH_MS = 30_000;
/** The tile filters. */
const FILTERS = ["all", "open", "free"] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Everything the page holds.
 */
type State = {
	api: Api;
	/**
	 * What `GET /tables` answered, or null before it did.
	 */
	data: TablesAnswer | null;
	/**
	 * The table in the side panel, by name.
	 */
	selected: string | null;
	/**
	 * The tab of the side panel: the bill, or the table's setup (QR code, Remove table).
	 */
	tab: PanelTab;
	/**
	 * The units waiting to be removed from the selected table's bill, by order line id.
	 * A draft: nothing leaves the bill until Save changes.
	 */
	removals: Record<number, number>;
	filter: Filter;
	/**
	 * Where each part is drawn.
	 */
	stats: HTMLElement;
	filters: HTMLElement;
	grid: HTMLElement;
	panel: HTMLElement;
	warning: HTMLElement;
	addForm: HTMLFormElement;
	addInput: HTMLInputElement;
};

/**
 * Money in the shop's currency, without ".00" when whole.
 * @param s The page state.
 * @param cents The amount.
 * @returns The formatted amount.
 */
function money(s: State, cents: number) {
	return new Intl.NumberFormat(s.api.locale, {
		style: "currency",
		currency: s.data?.currency ?? "USD",
		trailingZeroDisplay: "stripIfInteger",
	} as Intl.NumberFormatOptions).format(cents / 100);
}

/**
 * How long ago a time was: "9 min", "1 h 12 min".
 * @param s The page state.
 * @param iso The ISO time.
 * @returns The duration.
 */
function since(s: State, iso: string) {
	const min = Math.max(
		0,
		Math.floor((Date.now() - new Date(iso).getTime()) / 60_000),
	);
	return min < 60
		? s.api.t("time.min", { min })
		: s.api.t("time.h_min", { h: Math.floor(min / 60), min: min % 60 });
}

/**
 * "4 items" / "1 item".
 * @param s The page state.
 * @param count How many units.
 * @returns The text.
 */
function itemsText(s: State, count: number) {
	return s.api.t(count === 1 ? "tables.item" : "tables.items", { count });
}

/**
 * When a table's code was made, in the page's language.
 * @param s The page state.
 * @param table The table.
 * @returns "Made 3 Oct 2026, 18:02", or null when there is no code.
 */
function madeAt(s: State, table: TableRow) {
	const made = table.qr?.made_at;
	if (!made) return null;
	const date = new Intl.DateTimeFormat(s.api.locale, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(made));
	return s.api.t("qr.made", { date });
}

/**
 * Print a table's QR code as a slip: the table, the shop, "Scan to order",
 * the date, the code.
 * @param s The page state.
 * @param table The table.
 */
function printQr(s: State, table: TableRow) {
	const { api } = s;
	if (!table.qr) return;
	api.print({
		title: table.name,
		lines: [api.shop.name, api.t("slip.scan"), madeAt(s, table) ?? ""],
		qr: table.qr.url,
	});
}

/**
 * "New QR code": ask the server for a fresh code, show it, print it.
 * @param s The page state.
 * @param table The table.
 */
async function newCode(s: State, table: TableRow) {
	const { api } = s;
	const res = await api.fetch(`/tables/${encodeURIComponent(table.name)}/qr`, {
		method: "POST",
	});
	if (!res.ok) return api.toast(api.t("qr.failed"), "error");
	table.qr = await res.json();
	render(s);
	printQr(s, table);
}

/**
 * "Print bill": the table's bill as a receipt before the guests pay, the
 * same slip as the Sell screen's (it shows what is due).
 * @param s The page state.
 * @param table The table.
 */
async function printBill(s: State, table: TableRow) {
	const { api } = s;
	const res = await api.fetch(`/tables/${encodeURIComponent(table.name)}/bill`);
	if (!res.ok) return api.toast(api.t("tables.load_failed"), "error");
	api.printReceipt(await res.json());
}

/**
 * "Remove QR code", after asking: the table has no code any more, so guests
 * who hold the old one can not order.
 * @param s The page state.
 * @param table The table.
 */
function removeCode(s: State, table: TableRow) {
	const { api } = s;
	const yes = api.ui.button(api.t("tables.remove"), { variant: "destructive" });
	const no = api.ui.button(api.t("tables.cancel"), { variant: "outline" });
	const d = api.dialog({
		title: api.t("qr.remove_title", { table: table.name }),
		description: api.t("qr.remove_body"),
		footer: [no, yes],
	});
	no.onclick = () => d.close();
	yes.onclick = async () => {
		d.close();
		const res = await api.fetch(
			`/tables/${encodeURIComponent(table.name)}/qr`,
			{ method: "DELETE" },
		);
		if (!res.ok) return api.toast(api.t("qr.failed"), "error");
		s.data = await res.json();
		api.toast(api.t("qr.removed"));
		render(s);
	};
}

/**
 * "Add items": the Sell screen for the table. The cart joins its open order,
 * or starts one; then it comes back here.
 * @param api The extension api.
 * @param table The table.
 */
function addItems(api: Api, table: TableRow) {
	if (table.customer_id == null) return;
	const back = encodeURIComponent(location.pathname);
	// no full page load: the browser would leave full screen
	api.visit(`/pos?customer=${table.customer_id}&back=${back}`);
}

/**
 * Cents from what was typed in a money box ("12.50", "12,5").
 * @param text The box's value.
 * @returns The cents, or 0 when it is not a number.
 */
function centsOf(text: string) {
	const n = Number(text.replace(",", ".").trim());
	return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/** A table's open bill. */
type OpenBill = NonNullable<TableRow["order"]>;
/** How long after the Pay dialog opens its amount box takes the focus (the dialog focuses itself first). */
const FOCUS_MS = 50;
/** The quick percent buttons of the discount box. */
const QUICK_PERCENTS = [5, 10, 15, 20];

/**
 * What the bill's discount is called: the code, or "10% off"; "" for a fixed amount.
 * @param s The page state.
 * @param order The bill.
 * @returns The label.
 */
function discountLabel(s: State, order: OpenBill) {
	if (order.coupon_code) return order.coupon_code;
	return order.discount_type === "percent"
		? s.api.t("discount.percent_off", { value: order.discount_value })
		: "";
}

/**
 * Set, change or take off the discount of a table's bill, and draw the page again.
 * @param s The page state.
 * @param name The table name.
 * @param body `{ type, value }`, `{ coupon }`, or `{}` to take it off.
 * @returns Null when done, else the refusal to show.
 */
async function sendDiscount(
	s: State,
	name: string,
	body: { type?: "percent" | "fixed"; value?: number; coupon?: string },
) {
	const { api } = s;
	const res = await api.fetch(`/tables/${encodeURIComponent(name)}/discount`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const answer = await res.json().catch(() => null);
	if (!res.ok) return String(answer?.error ?? api.t("discount.failed"));
	s.data = answer;
	render(s);
	return null;
}

/**
 * The discount box of the Pay dialog, wired: percent or amount with Apply,
 * quick percents, a discount code, Remove discount.
 * @param s The page state.
 * @param name The table name.
 * @param order The bill.
 * @param done Called once the bill has its new discount, to draw the dialog again.
 * @returns The box.
 */
function discountBox(
	s: State,
	name: string,
	order: OpenBill,
	done: () => void,
) {
	const { api } = s;
	let type: "percent" | "fixed" =
		!order.coupon_code && order.discount_type === "fixed" ? "fixed" : "percent";
	const error = (<p class="text-xs text-destructive" hidden />) as HTMLElement;
	const value = api.ui.input({
		inputmode: "decimal",
		"aria-label": api.t("discount.title"),
		"data-discount-value": "",
	});
	value.classList.add("min-w-0", "flex-1");
	// the bill's own discount, to change it; a code is not a number
	if (order.discount && !order.coupon_code)
		value.value =
			order.discount_type === "percent"
				? String(order.discount_value)
				: (order.discount_value / 100).toFixed(2);
	const code = api.ui.input({
		id: "restaurant-discount-code",
		autocomplete: "off",
		autocapitalize: "characters",
		placeholder: api.t("discount.enter_code"),
	});
	code.classList.add("min-w-0", "flex-1", "font-mono", "uppercase");
	const apply = api.ui.button(api.t("discount.apply"));
	const applyCode = api.ui.button(api.t("discount.apply_code"), {
		variant: "outline",
	});
	/**
	 * Send a discount; on a refusal show it and let the buttons work again.
	 * @param body What to send.
	 */
	const send = async (body: Parameters<typeof sendDiscount>[2]) => {
		apply.disabled = applyCode.disabled = true;
		const refusal = await sendDiscount(s, name, body);
		if (!refusal) return done();
		error.textContent = refusal;
		error.hidden = false;
		apply.disabled = applyCode.disabled = false;
	};
	const symbol =
		money(s, 0).replace(/[\d.,\s]/g, "") || (s.data?.currency ?? "");
	const types = (["percent", "fixed"] as const).map(function typeButton(kind) {
		const button = (
			<button
				type="button"
				class="rounded px-2.5 text-sm tabular-nums"
				data-discount-type={kind}
			>
				{kind === "percent" ? "%" : symbol}
			</button>
		) as HTMLButtonElement;
		button.onclick = () => {
			type = kind;
			paint();
		};
		return button;
	});
	/**
	 * Show which of percent / amount is picked.
	 */
	const paint = () => {
		for (const button of types) {
			const on = button.dataset.discountType === type;
			button.className = `rounded px-2.5 text-sm tabular-nums ${on ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`;
			button.setAttribute("aria-pressed", on ? "true" : "false");
		}
		value.placeholder = type === "percent" ? "10" : "0.00";
	};
	paint();
	apply.onclick = () =>
		send(
			type === "percent"
				? {
						type,
						value: Math.min(100, Math.max(0, Math.floor(Number(value.value)))),
					}
				: { type, value: centsOf(value.value) },
		);
	value.onkeydown = (e) => {
		if (e.key === "Enter") apply.click();
	};
	applyCode.onclick = () => {
		if (code.value.trim()) void send({ coupon: code.value.trim() });
	};
	code.onkeydown = (e) => {
		if (e.key === "Enter") applyCode.click();
	};
	const quick = QUICK_PERCENTS.map(function quickButton(percent) {
		const button = api.ui.button(`${percent}%`, {
			size: "sm",
			variant: "outline",
		});
		button.onclick = () => send({ type: "percent", value: percent });
		return button;
	});
	let remove: HTMLElement | null = null;
	if (order.discount) {
		remove = (
			<button
				type="button"
				class="w-fit text-sm font-medium text-destructive hover:underline"
			>
				{api.t("discount.remove")}
			</button>
		) as HTMLButtonElement;
		remove.onclick = () => send({});
	}
	return (
		<DiscountBox
			applied={
				order.discount
					? {
							label: discountLabel(s, order),
							amount: money(s, order.discount),
						}
					: null
			}
			types={types}
			value={value}
			apply={apply}
			quick={quick}
			code={code}
			applyCode={applyCode}
			remove={remove}
			error={error}
			texts={{
				title: api.t("discount.title"),
				add: api.t("discount.add"),
				code: api.t("discount.code"),
			}}
		/>
	) as HTMLElement;
}

/**
 * The quick amounts under the amount received box: what is due, and the next
 * whole 5 / 10 / 20 / 50 above it (the Sell screen's rule).
 * @param due The cents due.
 * @returns The amounts in cents, smallest first.
 */
function quickAmounts(due: number) {
	const set = new Set<number>([due]);
	for (const note of [5, 10, 20, 50]) {
		const v = Math.ceil(due / (note * 100)) * note * 100;
		if (v > due) set.add(v);
	}
	return [...set].sort((a, b) => a - b);
}

/**
 * "Pay": a dialog like the Sell screen's checkout, for the table's bill
 * (`orders.pay` through the extension's route): a discount or a code, the
 * payment method, the amount received with the change (a method that takes
 * cash), and the waiter. Less than what is due is a part payment; the rest stays open.
 * Once paid, it offers the receipt.
 * @param s The page state.
 * @param table The table.
 */
function pay(s: State, table: TableRow) {
	const { api } = s;
	if (!table.order || !s.data) return;
	const { methods, sales_staff: staff } = s.data;
	let order = table.order;
	let method = methods[0] ?? null;
	const input = api.ui.input({
		id: "restaurant-pay-amount",
		inputmode: "decimal",
		"data-pay-amount": "",
	});
	const waiter = staff.length
		? api.ui.select(
				[
					{ value: "none", label: api.t("pay.no_waiter") },
					...staff.map((p) => ({ value: String(p.id), label: p.name })),
				],
				{ id: "restaurant-pay-waiter" },
			)
		: null;
	// the waiter already on the bill (named at the Sell screen), if still active
	if (waiter)
		waiter.value = staff.some((p) => p.id === order.sales_staff_id)
			? String(order.sales_staff_id)
			: "none";
	const sums = (<div />) as HTMLElement;
	const error = (<p class="text-sm text-destructive" hidden />) as HTMLElement;
	const record = api.ui.button("");
	const cancelBtn = api.ui.button(api.t("tables.cancel"), {
		variant: "outline",
	});
	/**
	 * The cents the guests give: what is typed for a method that takes cash, else what is due.
	 * @returns The cents.
	 */
	const received = () => (method?.tendered ? centsOf(input.value) : order.due);
	/**
	 * The sums and the button, from the method and what is typed.
	 */
	const update = () => {
		const got = received();
		const already = order.total - order.due;
		sums.replaceChildren(
			<PaySums
				rows={[
					...(order.discount || order.tax
						? [
								{
									label: api.t("pay.subtotal"),
									amount: money(s, order.subtotal),
								},
							]
						: []),
					...(order.discount
						? [
								{
									label: [api.t("discount.title"), discountLabel(s, order)]
										.filter(Boolean)
										.join(" · "),
									amount: `−${money(s, order.discount)}`,
								},
							]
						: []),
					...(order.tax
						? [
								{
									label: order.tax_included
										? api.t("tables.tax_included", { label: order.tax_label })
										: order.tax_label,
									amount: money(s, order.tax),
								},
							]
						: []),
					{
						label: api.t("tables.total"),
						amount: money(s, order.total),
						strong: true,
					},
					...(already
						? [
								{ label: api.t("pay.already"), amount: money(s, already) },
								{ label: api.t("pay.due"), amount: money(s, order.due) },
							]
						: []),
					{ label: api.t("pay.paid_row"), amount: money(s, got) },
					{
						label: api.t("pay.change"),
						amount: money(s, Math.max(0, got - order.due)),
						strong: true,
					},
				]}
			/>,
		);
		// less than what is due is a part payment: the button says what it records
		record.textContent =
			got < order.due
				? api.t("pay.record", { amount: money(s, got) })
				: api.t("pay.confirm", { amount: money(s, order.due) });
		record.disabled = got <= 0 || !method;
	};
	input.oninput = update;
	const d = api.dialog({
		title: api.t("pay.title", { table: table.name }),
		description: api.t("pay.description"),
		footer: [cancelBtn, record],
	});
	// the app's own method buttons, so the customer's screen shows what is picked
	const picker = api.paymentPicker({
		methods,
		amount: order.due,
		onChange(m) {
			method = m;
			draw(false);
		},
	});
	void d.closed.then(picker.destroy);
	/**
	 * Draw the body from the bill as it is now (again after a discount or another method).
	 * @param fresh True to start the amount received at what is due again.
	 */
	const draw = (fresh = true) => {
		const now = s.data?.tables.find((t) => t.name === table.name)?.order;
		if (!now) return d.close(); // a discount of the whole bill paid it
		order = now;
		if (fresh) input.value = (order.due / 100).toFixed(2);
		update();
		const quick = quickAmounts(order.due).map(function quickButton(cents) {
			const button = api.ui.button(
				cents === order.due ? api.t("pay.exact") : money(s, cents),
				{ variant: "outline" },
			);
			button.onclick = () => {
				input.value = (cents / 100).toFixed(2);
				update();
			};
			return button;
		});
		picker.setAmount(order.due);
		d.body.replaceChildren(
			<PayBody
				discount={discountBox(s, table.name, order, draw)}
				methods={picker.el}
				cash={method?.tendered ? { input, quick } : null}
				waiter={waiter}
				sums={sums}
				error={error}
				texts={{
					received: api.t("pay.received"),
					waiter: api.t("pay.waiter"),
				}}
			/>,
		);
	};
	draw();
	// ready to type the cash: after the dialog took the focus for itself
	setTimeout(function focusAmount() {
		input.focus();
		input.select();
	}, FOCUS_MS);
	cancelBtn.onclick = () => d.close();
	record.onclick = async () => {
		const got = received();
		const due = order.due;
		record.disabled = true;
		const res = await api.fetch(
			`/tables/${encodeURIComponent(table.name)}/pay`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					method: method?.name,
					received: got,
					sales_staff_id:
						waiter && waiter.value !== "none" ? Number(waiter.value) : null,
				}),
			},
		);
		const answer = await res.json().catch(() => null);
		if (!res.ok) {
			error.textContent = answer?.error ?? api.t("pay.failed");
			error.hidden = false;
			record.disabled = false;
			return;
		}
		s.data = answer;
		s.removals = {};
		render(s);
		picker.destroy(); // the money is taken: the customer's screen stops showing the method
		// paid: say so, with the change, and offer the receipt
		const printBtn = withIcon(
			api.ui.button(api.t("pay.print"), { variant: "outline" }),
			"printer",
		);
		const doneBtn = api.ui.button(api.t("pay.close"));
		printBtn.onclick = () => api.printReceipt(answer.order);
		doneBtn.onclick = () => d.close();
		d.body.replaceChildren(
			<div class="grid gap-2" data-paid>
				<p class="font-medium">
					{api.t(got >= due ? "pay.paid" : "pay.part_paid", {
						table: table.name,
						amount: money(s, Math.min(got, due)),
					})}
				</p>
				<p class="flex items-baseline gap-1.5 text-sm text-muted-foreground">
					{method?.name} · {api.t("pay.change")}:
					<span
						class="text-xl font-semibold text-amber-600 tabular-nums dark:text-primary"
						data-paid-change
					>
						{money(s, Math.max(0, got - due))}
					</span>
				</p>
			</div>,
		);
		cancelBtn.replaceWith(printBtn);
		record.replaceWith(doneBtn);
	};
}

/** One line of a table's bill. */
type BillLine = NonNullable<TableRow["order"]>["items"][number];

/**
 * How many units wait to be removed.
 * @param s The page state.
 * @returns The count.
 */
function removeCount(s: State) {
	return Object.values(s.removals).reduce((sum, n) => sum + n, 0);
}

/**
 * The remove button of a bill line: a small bin, red when pointed at.
 * It only changes what is on screen (one unit less); nothing leaves the bill until Save changes.
 * The last unit of a bill can not go: that is a void, on the order page.
 * @param s The page state.
 * @param table The table.
 * @param line The bill line.
 * @returns The button.
 */
function removeButton(s: State, table: TableRow, line: BillLine) {
	const label = s.api.t("remove.label", { name: line.name });
	const button = withIcon(
		(
			<button
				type="button"
				class="-my-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive disabled:pointer-events-none disabled:opacity-40"
				aria-label={label}
				title={label}
			/>
		) as HTMLButtonElement,
		"trash",
	);
	button.disabled = (table.order?.count ?? 0) - removeCount(s) <= 1;
	button.onclick = () => {
		s.removals[line.id] = (s.removals[line.id] ?? 0) + 1;
		render(s);
	};
	return button;
}

/**
 * The bar under the bill while units wait to be removed: how many, Undo and Save changes.
 * @param s The page state.
 * @param table The table.
 * @returns The bar, or null when nothing waits.
 */
function removeDraft(s: State, table: TableRow) {
	const { api } = s;
	const count = removeCount(s);
	if (!count) return null;
	const undo = api.ui.button(api.t("remove.undo"), {
		size: "sm",
		variant: "outline",
	});
	const save = api.ui.button(api.t("remove.save"), { size: "sm" });
	undo.onclick = () => {
		s.removals = {};
		render(s);
	};
	save.onclick = () => {
		save.disabled = true;
		undo.disabled = true;
		void saveRemovals(s, table);
	};
	return (
		<div
			class="grid gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm"
			data-remove-draft
		>
			<p>
				{api.t(count === 1 ? "remove.draft_one" : "remove.draft_other", {
					count,
				})}
			</p>
			<div class="flex justify-end gap-2">
				{undo}
				{save}
			</div>
		</div>
	) as HTMLElement;
}

/**
 * "Save changes": take the drafted units off the table's bill, in one go
 * (one line in the order's history; the kitchen is told at once).
 * @param s The page state.
 * @param table The table.
 */
async function saveRemovals(s: State, table: TableRow) {
	const { api } = s;
	const res = await api.fetch(
		`/tables/${encodeURIComponent(table.name)}/items/remove`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				items: Object.entries(s.removals).map(([id, qty]) => ({
					order_item_id: Number(id),
					qty,
				})),
			}),
		},
	);
	const answer = await res.json().catch(() => null);
	if (!res.ok) {
		api.toast(answer?.error ?? api.t("remove.failed"), "error");
		render(s); // the buttons work again, the draft stays
		return;
	}
	s.removals = {};
	s.data = answer;
	api.toast(api.t("remove.done"));
	render(s);
}

/**
 * "Move or join tables": a dialog to pick the table the guests go to.
 * A free table gets the bill; a table with a bill gets one bill of both.
 * @param s The page state.
 * @param table The table the guests leave.
 */
function moveOrJoin(s: State, table: TableRow) {
	const { api, data } = s;
	const order = table.order;
	if (!order || !data) return;
	const others = data.tables.filter((t) => t.name !== table.name);
	const picks: Record<MoveMode, { name: string; line: string }[]> = {
		move: others
			.filter((t) => !t.order)
			.map((t) => ({ name: t.name, line: api.t("tables.badge_free") })),
		join: others
			.filter((t) => t.order)
			.map((t) => ({ name: t.name, line: money(s, t.order!.total) })),
	};
	// start where there is something to pick
	let mode: MoveMode =
		picks.move.length || !picks.join.length ? "move" : "join";
	let picked: string | null = null;
	const confirm = api.ui.button(api.t("move.pick"));
	const cancelBtn = api.ui.button(api.t("tables.cancel"), {
		variant: "outline",
	});
	const d = api.dialog({
		title: api.t("move.title", { table: table.name }),
		description: " ",
		size: "lg",
		footer: [cancelBtn, confirm],
	});
	// the line under the title says what the picked tab does
	const about = d.el.querySelector("h2 + p");
	/**
	 * Draw the tabs, the cards and the summary for the current tab and pick.
	 */
	const draw = () => {
		const target = others.find((t) => t.name === picked);
		const count = picks[mode].length;
		if (about)
			about.textContent = api.t(`move.desc_${mode}`, {
				total: money(s, order.total),
			});
		const after = target
			? api.t("move.after", { from: table.name, to: target.name })
			: "";
		const summary = !target
			? null
			: target.order
				? {
						move: null,
						rows: [
							[
								api.t("move.bill_of", { table: table.name }),
								money(s, order.total),
							],
							[
								api.t("move.bill_of", { table: target.name }),
								money(s, target.order.total),
							],
						] as [string, string][],
						total: [
							api.t("move.one_bill", { table: target.name }),
							money(s, order.total + target.order.total),
						] as [string, string],
						after,
					}
				: {
						move: {
							from: table.name,
							to: target.name,
							bill: api.t("move.bill_amount", {
								total: money(s, order.total),
							}),
						},
						rows: [],
						total: null,
						after,
					};
		d.body.replaceChildren(
			<MoveBody
				mode={mode}
				onMode={(next) => {
					if (next === mode) return;
					mode = next;
					picked = null;
					draw();
				}}
				picks={picks[mode]}
				picked={picked}
				onPick={(name) => {
					picked = name;
					draw();
				}}
				summary={summary}
				texts={{
					tabMove: api.t("move.tab_move"),
					tabJoin: api.t("move.tab_join"),
					heading: api.t(`move.pick_${mode}`),
					count: api.t(`move.count_${mode}${count === 1 ? "_one" : ""}`, {
						count,
					}),
					what: api.t("move.what"),
					none: api.t(`move.none_${mode}`),
				}}
			/>,
		);
		confirm.textContent = target
			? api.t(target.order ? "move.join" : "move.to", { table: target.name })
			: api.t("move.pick");
		confirm.disabled = !target;
	};
	draw();
	cancelBtn.onclick = () => d.close();
	confirm.onclick = async () => {
		const target = others.find((t) => t.name === picked);
		if (!target) return;
		confirm.disabled = true;
		const res = await api.fetch(
			`/tables/${encodeURIComponent(table.name)}/move`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ to: target.name }),
			},
		);
		const answer = await res.json().catch(() => null);
		if (!res.ok) {
			api.toast(answer?.error ?? api.t("move.failed"), "error");
			confirm.disabled = false;
			return;
		}
		d.close();
		s.data = answer;
		s.removals = {};
		s.selected = target.name;
		api.toast(
			api.t(target.order ? "move.joined" : "move.moved", {
				from: table.name,
				to: target.name,
			}),
		);
		render(s);
	};
}

/**
 * "Add tables": send what was typed, draw the new list.
 * @param s The page state.
 */
async function addTables(s: State) {
	const { api } = s;
	const names = s.addInput.value.trim();
	if (!names) return;
	const res = await api.fetch("/tables", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ names }),
	});
	const answer = await res.json().catch(() => null);
	if (!res.ok)
		return api.toast(answer?.error ?? api.t("tables.load_failed"), "error");
	s.data = answer;
	s.addInput.value = "";
	api.toast(api.t("tables.added"));
	render(s);
}

/**
 * "Remove table", after asking.
 * @param s The page state.
 * @param table The table.
 */
function removeTable(s: State, table: TableRow) {
	const { api } = s;
	const yes = api.ui.button(api.t("tables.remove"), { variant: "destructive" });
	const no = api.ui.button(api.t("tables.cancel"), { variant: "outline" });
	const d = api.dialog({
		title: api.t("tables.remove_title", { table: table.name }),
		description: api.t("tables.remove_body"),
		footer: [no, yes],
	});
	no.onclick = () => d.close();
	yes.onclick = async () => {
		d.close();
		const res = await api.fetch(`/tables/${encodeURIComponent(table.name)}`, {
			method: "DELETE",
		});
		const answer = await res.json().catch(() => null);
		if (!res.ok)
			return api.toast(answer?.error ?? api.t("tables.load_failed"), "error");
		s.data = answer;
		s.selected = null;
		api.toast(api.t("tables.removed", { table: table.name }));
		render(s);
	};
}

/**
 * One number with its label and a short note.
 * @param label What it counts.
 * @param value The number.
 * @param note The small text after it.
 * @param key A stable name for tests; "unpaid" is shown in the accent colour.
 * @returns The element.
 */
function stat(label: string, value: string, note: string, key: string) {
	return (
		<div class="grid gap-1.5 md:px-8 md:first:pl-0" data-stat={key}>
			<span class="text-sm text-muted-foreground">{label}</span>
			<span class="flex items-end gap-2">
				<span
					class={`text-2xl font-semibold tabular-nums ${key === "unpaid" ? "text-amber-600 dark:text-primary" : ""}`}
				>
					{value}
				</span>
				<span class="text-sm text-muted-foreground/70">{note}</span>
			</span>
		</div>
	);
}

/**
 * A panel button: as wide as its grid cell (two side by side), the standard size.
 * @param button The button.
 * @returns The button.
 */
function big<T extends HTMLElement>(button: T) {
	button.classList.add("w-full");
	return button;
}

/**
 * Draw the four numbers under the header.
 * @param s The page state.
 * @param tables Every table.
 */
function renderStats(s: State, tables: TableRow[]) {
	const { api } = s;
	const open = tables.filter((t) => t.order);
	const unpaid = open.reduce((sum, t) => sum + (t.order?.total ?? 0), 0);
	const ready = tables.filter((t) => t.qr).length;
	const total = tables.length;
	s.stats.replaceChildren(
		stat(
			api.t(open.length === 1 ? "stats.unpaid_one" : "stats.unpaid", {
				count: open.length,
			}),
			money(s, unpaid),
			"",
			"unpaid",
		),
		stat(
			api.t("stats.open"),
			String(open.length),
			api.t("stats.of", { total }),
			"open",
		),
		stat(
			api.t("stats.free"),
			String(total - open.length),
			api.t("stats.ready"),
			"free",
		),
		stat(api.t("stats.qr"), String(ready), api.t("stats.of", { total }), "qr"),
	);
}

/**
 * Draw the All / Open bill / Free tabs with their counts.
 * @param s The page state.
 * @param tables Every table.
 */
function renderFilters(s: State, tables: TableRow[]) {
	const counts: Record<Filter, number> = {
		all: tables.length,
		open: tables.filter((t) => t.order).length,
		free: tables.filter((t) => !t.order).length,
	};
	s.filters.replaceChildren(
		...FILTERS.map(function tab(filter) {
			const on = s.filter === filter;
			const button = (
				<button
					type="button"
					class={`flex items-center gap-1.5 rounded-md px-3 py-1 text-sm ${on ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
					aria-pressed={on ? "true" : "false"}
					data-filter={filter}
				>
					{s.api.t(`filter.${filter}`)}
					<span class="text-muted-foreground tabular-nums">
						{counts[filter]}
					</span>
				</button>
			) as HTMLButtonElement;
			button.onclick = () => {
				s.filter = filter;
				render(s);
			};
			return button;
		}),
	);
}

/**
 * Draw the tiles of the current filter.
 * @param s The page state.
 * @param tables Every table.
 */
function renderGrid(s: State, tables: TableRow[]) {
	const { api } = s;
	const shown = tables.filter(
		(t) => s.filter === "all" || (s.filter === "open" ? !!t.order : !t.order),
	);
	s.grid.replaceChildren(
		...(shown.length
			? shown.map(function tile(table) {
					const el = (
						<TableTile
							name={table.name}
							hasQr={!!table.qr}
							status={
								table.order
									? api.t("tables.open_for", {
											time: since(s, table.order.opened_at),
										})
									: api.t("tables.badge_free")
							}
							open={!!table.order}
							total={table.order ? money(s, table.order.total) : null}
							count={table.order ? itemsText(s, table.order.count) : null}
							selected={s.selected === table.name}
							texts={{
								noQr: api.t("tables.no_qr"),
								noBill: api.t("tables.free"),
							}}
						/>
					) as HTMLButtonElement;
					el.onclick = () => {
						if (s.selected !== table.name) {
							s.removals = {};
							s.tab = "bill"; // another table opens on its bill
						}
						s.selected = table.name;
						render(s);
					};
					return el;
				})
			: [
					<p class="col-span-full py-10 text-center text-sm text-muted-foreground">
						{api.t(tables.length ? "tables.none_here" : "tables.none")}
					</p>,
				]),
	);
}

/**
 * The rename form of the Table setup tab: the name in a box, and Rename.
 * @param s The page state.
 * @param table The table.
 * @returns The form.
 */
function renameForm(s: State, table: TableRow) {
	const { api } = s;
	const input = api.ui.input({
		id: "restaurant-table-name",
		value: table.name,
		maxlength: "50",
		autocomplete: "off",
	});
	const save = api.ui.button(api.t("rename.button"), {
		type: "submit",
		variant: "outline",
	});
	const form = (
		<form class="grid gap-2" data-rename>
			<label class="text-sm font-medium" for={input.id}>
				{api.t("rename.label")}
			</label>
			<div class="flex gap-2">
				{input}
				{save}
			</div>
			{table.qr ? (
				<p class="text-xs text-muted-foreground">{api.t("rename.hint")}</p>
			) : (
				""
			)}
		</form>
	) as HTMLFormElement;
	form.onsubmit = (e) => {
		e.preventDefault();
		void rename(s, table, input.value.trim());
	};
	return form;
}

/**
 * "Rename": give the table a new name; its bill, kitchen tickets and place stay.
 * @param s The page state.
 * @param table The table.
 * @param to The new name.
 */
async function rename(s: State, table: TableRow, to: string) {
	const { api } = s;
	if (!to || to === table.name) return;
	const res = await api.fetch(
		`/tables/${encodeURIComponent(table.name)}/rename`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ to }),
		},
	);
	const answer = await res.json().catch(() => null);
	if (!res.ok)
		return api.toast(answer?.error ?? api.t("tables.load_failed"), "error");
	s.data = answer;
	s.selected = to;
	api.toast(api.t("rename.done", { table: to }));
	render(s);
}

/**
 * Draw the side panel for the selected table.
 * @param s The page state.
 * @param table The table, or undefined when none is picked.
 */
function renderPanel(s: State, table: TableRow | undefined) {
	const { api } = s;
	if (!table) {
		s.panel.replaceChildren();
		return;
	}
	const order = table.order;
	const add = big(withIcon(api.ui.button(api.t("tables.add_items")), "plus"));
	const payBtn = big(
		withIcon(
			api.ui.button(api.t("tables.pay"), { variant: "outline" }),
			"card",
		),
	);
	add.onclick = () => addItems(api, table);
	payBtn.onclick = () => pay(s, table);
	const move = big(
		withIcon(
			api.ui.button(api.t("move.short"), { variant: "outline" }),
			"move",
		),
	);
	move.onclick = () => moveOrJoin(s, table);
	move.disabled = !order;
	payBtn.disabled = !order;
	const billBtn = big(
		withIcon(
			api.ui.button(api.t("tables.print_bill"), { variant: "outline" }),
			"printer",
		),
	);
	billBtn.dataset.printBill = "";
	billBtn.onclick = () => printBill(s, table);
	billBtn.disabled = !order;
	const print = big(
		withIcon(
			api.ui.button(api.t("qr.print"), { variant: "outline" }),
			"printer",
		),
	);
	print.onclick = () => printQr(s, table);
	print.disabled = !table.qr;
	const fresh = big(
		withIcon(
			api.ui.button(api.t(table.qr ? "qr.new" : "qr.make"), {
				variant: "outline",
			}),
			table.qr ? "refresh" : "qr",
		),
	);
	fresh.onclick = () => newCode(s, table);
	const qrButtons = table.qr ? [print, fresh] : [fresh, print];
	if (table.qr) {
		// under the two, as wide as both
		const drop = big(
			withIcon(
				api.ui.button(api.t("qr.remove"), { variant: "outline" }),
				"trash",
			),
		);
		drop.classList.add("col-span-2");
		drop.onclick = () => removeCode(s, table);
		qrButtons.push(drop);
	}
	let remove: HTMLElement | null = null;
	if (s.data?.can_manage) {
		remove = withIcon(
			(
				<button
					type="button"
					class="flex w-fit items-center gap-2 text-sm font-medium text-destructive hover:underline"
				>
					{api.t("tables.remove_table")}
				</button>
			) as HTMLButtonElement,
			"trash",
		);
		remove.onclick = () => removeTable(s, table);
	}
	const opened = order
		? api.t("tables.opened", {
				time: new Intl.DateTimeFormat(api.locale, {
					timeStyle: "short",
				}).format(new Date(order.opened_at)),
				ago: since(s, order.opened_at),
			})
		: api.t("tables.free");
	// the bill's list keeps its place when the page draws again (the 30 s refresh)
	const scrolled = s.panel.querySelector("[data-bill-scroll]")?.scrollTop ?? 0;
	s.panel.replaceChildren(
		<TablePanel
			name={table.name}
			subtitle={opened}
			open={!!order}
			tab={s.tab}
			onTab={(tab) => {
				s.tab = tab;
				render(s);
			}}
			bill={
				order && {
					heading: itemsText(s, order.count - removeCount(s)),
					href: `/orders/${order.id}`,
					// as drafted: a line with every unit removed is gone from the list
					lines: order.items
						.filter((i) => i.qty > (s.removals[i.id] ?? 0))
						.map(function shown(i) {
							const qty = i.qty - (s.removals[i.id] ?? 0);
							return {
								qty,
								name: i.name,
								amount: money(s, (i.amount / i.qty) * qty),
								note: i.note,
								remove: removeButton(s, table, i),
							};
						}),
					draft: removeDraft(s, table),
					discount: order.discount
						? {
								label: [api.t("discount.title"), discountLabel(s, order)]
									.filter(Boolean)
									.join(" · "),
								amount: `−${money(s, order.discount)}`,
							}
						: null,
					tax: order.tax
						? {
								label: order.tax_included
									? api.t("tables.tax_included", { label: order.tax_label })
									: order.tax_label,
								amount: money(s, order.tax),
							}
						: null,
					total: money(s, order.total),
				}
			}
			mainButtons={[add, payBtn]}
			otherButtons={[billBtn, move]}
			rename={s.data?.can_manage ? renameForm(s, table) : null}
			qrSvg={table.qr ? api.qr(table.qr.url) : null}
			made={madeAt(s, table)}
			qrButtons={qrButtons}
			remove={remove}
			texts={{
				badge: api.t(order ? "tables.badge_open" : "tables.badge_free"),
				tabBill: api.t("tables.tab_bill"),
				tabSetup: api.t("tables.tab_setup"),
				viewOrder: api.t("tables.view_order"),
				total: api.t("tables.total"),
				noBill: api.t("tables.free"),
				noBillBody: api.t("tables.no_bill_body"),
				qrTitle: api.t("qr.title"),
				qrBody: api.t("qr.body"),
				noQrTitle: api.t("qr.none_title"),
				noQrBody: api.t("qr.none_body"),
			}}
		/>,
	);
	const list = s.panel.querySelector("[data-bill-scroll]");
	if (list) list.scrollTop = scrolled;
}

/**
 * Draw the whole page from the last answer.
 * @param s The page state.
 */
function render(s: State) {
	const { data } = s;
	if (!data) return;
	s.warning.hidden = data.store_on;
	s.addForm.hidden = !data.can_manage;
	const tables = data.tables;
	// keep the picked table; else the first with an open bill, else the first
	if (!tables.some((t) => t.name === s.selected))
		s.selected = (tables.find((t) => t.order) ?? tables[0])?.name ?? null;
	// a draft belongs to a bill: none without one (paid or moved meanwhile)
	if (!tables.find((t) => t.name === s.selected)?.order) s.removals = {};
	renderStats(s, tables);
	renderFilters(s, tables);
	renderGrid(s, tables);
	renderPanel(
		s,
		tables.find((t) => t.name === s.selected),
	);
}

/**
 * Read the tables from the server and draw them.
 * @param s The page state.
 */
async function load(s: State) {
	try {
		const res = await s.api.fetch("/tables");
		if (!res.ok) throw new Error(String(res.status));
		s.data = await res.json();
		render(s);
	} catch {
		s.api.toast(s.api.t("tables.load_failed"), "error");
	}
}

const mount: PageScript = async (el, api) => {
	const addInput = api.ui.input({
		id: ADD_ID,
		placeholder: api.t("tables.add_placeholder"),
		autocomplete: "off",
		"aria-label": api.t("tables.add_label"),
	});
	addInput.classList.add("sm:w-[360px]");
	const addForm = (
		<form class="flex gap-2" hidden>
			{addInput}
			{withIcon(
				api.ui.button(api.t("tables.add_label"), {
					type: "submit",
					variant: "outline",
				}),
				"plus",
			)}
		</form>
	) as HTMLFormElement;
	const s: State = {
		api,
		data: null,
		selected: null,
		tab: "bill",
		removals: {},
		filter: "all",
		stats: (
			<div class="grid grid-cols-2 gap-y-4 border-y py-5 md:grid-cols-4 md:divide-x" />
		) as HTMLElement,
		filters: (
			<fieldset class="flex w-fit gap-1 rounded-lg border p-1" />
		) as HTMLElement,
		grid: (
			<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" />
		) as HTMLElement,
		// the page's full-height right column; under the tiles where there is none
		panel: api.aside ?? ((<div />) as HTMLElement),
		warning: (
			<p
				class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
				hidden
			>
				{api.t("tables.store_off")}
			</p>
		) as HTMLElement,
		addForm,
		addInput,
	};
	addForm.onsubmit = (e) => {
		e.preventDefault();
		addTables(s);
	};
	// no title or padding of its own: the app's page around it has both; Add tables sits next to its title
	if (api.actions) api.actions.append(addForm);
	el.replaceChildren(
		<div class="grid gap-7">
			{s.warning}
			{s.stats}
			<div class="grid gap-4">
				{s.filters}
				{s.grid}
			</div>
			{api.aside ? "" : s.panel}
		</div>,
	);
	await load(s);
	const timer = setInterval(() => load(s), REFRESH_MS);
	return () => {
		clearInterval(timer);
		addForm.remove();
		api.aside?.replaceChildren();
	};
};
export default mount;
