/**
 * Restaurant: tables with QR codes.
 * Staff add and remove tables on the extension's Tables page; the list is
 * kept in `ctx.data` ("tables"). Each table is one customer of the shop with
 * the same name, made when the table is added.
 * The manifest hides the app's Customers link; the extension's own Tables
 * page lists the tables instead. Its `app.*` texts make the Sell screen's
 * customer picker a table picker, and Pay later joins the table's bill.
 * Staff make a table's QR code on the Tables page. Each code
 * holds a random token, kept in `ctx.data`: a new code kills the old one,
 * and paying the table's bill kills it too, so the next guests need a new one.
 * A guest scans it, which opens the online store for the table, and
 * "Send to kitchen" posts the cart here: the first round opens an unpaid
 * order for the table's customer, every later round is added to it.
 * The Kitchen page shows every line of the tables' open bills as To do,
 * Preparing or Done; each line's step is kept in `ctx.data` per order
 * ("kitchen:<order id>") and forgotten once the bill is paid or voided.
 * See the extension guide for routes, pages, slots and data.
 */
import type {
	Customers,
	ExtensionData,
	Listeners,
	OrderFull,
	OrderLine,
	RouteContext,
	Routes,
} from "../types";
import {
	type Bill,
	type KitchenAnswer,
	type KitchenCancelled,
	type KitchenItem,
	KITCHEN_STEPS,
	type KitchenStep,
	type TableQr,
	type TableRow,
	type TablesAnswer,
} from "./assets/utils.ts";

/** How many random bytes a QR token holds. */
const TOKEN_BYTES = 16;
/** The most tables a shop may have, and the longest table name. */
const MAX_TABLES = 200;
const MAX_NAME = 50;
/** Who may add and remove tables (cashiers only make QR codes). */
const MANAGERS = ["admin", "manager"];

/**
 * The shop's tables, in the order they were added.
 * @param data The extension's data for the shop.
 * @returns The table names.
 */
async function tablesOf(data: ExtensionData): Promise<string[]> {
	return (await data.get<string[]>("tables")) ?? [];
}

/**
 * The names an "Add tables" text asks for. Pieces are split by commas or lines:
 * `1-30` = "Table 1" … "Table 30", `5` = "Table 5", anything else is a name as typed.
 * @param text What staff typed.
 * @param numbered Makes "Table 5" from 5, in the request's language.
 * @returns The names, trimmed, without blanks or repeats.
 */
export function parseTables(text: string, numbered: (n: number) => string) {
	const names: string[] = [];
	for (const piece of text.split(/[,\n]/).map((p) => p.trim())) {
		const range = piece.match(/^(\d+)\s*-\s*(\d+)$/);
		if (range) {
			const from = Number(range[1]);
			const to = Math.min(Number(range[2]), from + MAX_TABLES - 1);
			for (let n = from; n <= to; n++) names.push(numbered(n));
		} else if (/^\d+$/.test(piece)) names.push(numbered(Number(piece)));
		else if (piece) names.push(piece.slice(0, MAX_NAME));
	}
	return [...new Set(names)];
}

/**
 * The name a table's QR token is kept under in `ctx.data`.
 * @param table The table name.
 * @returns The data name.
 */
function qrKey(table: string) {
	return `qr:${table}`;
}

/**
 * The customer a table is, if there is one.
 * The search puts names that start with the text first, A–Z, so the exact
 * name comes before "Table 10" when "Table 1" is asked.
 * @param customers The shop's customers.
 * @param table The table name.
 * @returns The customer, or null.
 */
async function customerOf(customers: Customers, table: string) {
	const same = table.toLowerCase();
	const hits = await customers.search(table);
	return hits.find((c) => c.name.trim().toLowerCase() === same) ?? null;
}

/**
 * The customer a table is: found by name, else made now.
 * @param ctx The route context.
 * @param table The table name.
 * @returns The customer.
 */
async function tableCustomer(ctx: RouteContext, table: string) {
	return (
		(await customerOf(ctx.customers, table)) ??
		(await ctx.customers.create({ name: table, note: ctx.t("customer.note") }))
	);
}

/**
 * A database time as ISO: SQLite gives "2026-10-03 02:24:36" (UTC, no zone),
 * which a browser would read as its own local time.
 * @param time The stored time.
 * @returns The ISO time.
 */
function isoTime(time: string) {
	return /^\d{4}-\d{2}-\d{2} /.test(time) ? `${time.replace(" ", "T")}Z` : time;
}

/**
 * The link a QR code holds: the online store, opened for the table.
 * @param ctx The route context.
 * @param table The table name.
 * @param qr The table's kept token.
 * @returns The link and when the code was made.
 */
function qrOf(ctx: RouteContext, table: string, qr: TableQr | null) {
	if (!qr) return null;
	return {
		url: `${ctx.store_url}/?table=${encodeURIComponent(table)}&t=${qr.token}`,
		made_at: qr.made_at,
	};
}

/**
 * What a guest may see of the table's open order: no ids, no costs.
 * @param table The table name.
 * @param order The open order, or null when the table has none.
 * @returns The bill.
 */
function billOf(table: string, order: OrderFull | null): Bill {
	return {
		table,
		order: order && {
			reference: order.reference ?? `#${order.id}`,
			items: order.items.map((i) => ({
				name: i.name,
				qty: i.qty,
				price: i.price,
				note: i.note,
			})),
			subtotal: order.subtotal,
			tax: order.tax,
			tax_included: order.tax_included,
			total: order.total,
		},
	};
}

/**
 * The table a guest's request is for, checked: it is one of the shop's
 * tables and the token is the one of its current QR code.
 * @param ctx The route context.
 * @param table The table name the guest sent.
 * @param given The token the guest sent.
 * @returns The table name, or null when the code is old or made up.
 */
async function tableOf(ctx: RouteContext, table: unknown, given: unknown) {
	const name = String(table ?? "").trim();
	if (!name || !(await tablesOf(ctx.data)).includes(name)) return null;
	const qr = await ctx.data.get<TableQr>(qrKey(name));
	return qr && given === qr.token ? name : null;
}

/**
 * A refusal the guest can read.
 * @param message What went wrong.
 * @returns A 422 JSON answer.
 */
function refused(message: string) {
	return Response.json({ error: message }, { status: 422 });
}

/**
 * Every table with its customer, its current QR code and its open bill,
 * for the Tables page.
 * @param ctx The route context.
 * @returns The tables, the currency, whether the store is on, and whether this
 * staff member may add and remove tables.
 */
async function tablesAnswer(ctx: RouteContext): Promise<TablesAnswer> {
	const tables: TableRow[] = [];
	for (const name of await tablesOf(ctx.data)) {
		const customer = await customerOf(ctx.customers, name);
		const order = customer ? await ctx.orders.openFor(customer.id) : null;
		tables.push({
			name,
			customer_id: customer?.id ?? null,
			qr: qrOf(ctx, name, await ctx.data.get<TableQr>(qrKey(name))),
			order: order && {
				id: order.id,
				reference: order.reference ?? `#${order.id}`,
				subtotal: order.subtotal,
				total: order.total,
				due: order.total - (order.paid - order.change),
				sales_staff_id: order.sales_staff_id,
				discount: order.discount,
				discount_type: order.discount_type,
				discount_value: order.discount_value,
				coupon_code: order.coupon_code,
				tax: order.tax,
				tax_label: order.tax_label,
				tax_included: order.tax_included,
				count: order.items.reduce((n, i) => n + i.qty, 0),
				opened_at: isoTime(order.created_at),
				items: order.items.map((i) => ({
					id: i.id,
					name: i.name,
					qty: i.qty,
					amount: i.price * i.qty,
					note: i.note,
				})),
			},
		});
	}
	return {
		tables,
		...(await ctx.orders.payOptions()),
		currency: ctx.shop.currency,
		store_on: !!ctx.shop.online_enabled,
		can_manage: MANAGERS.includes(ctx.user?.role ?? ""),
	};
}

/**
 * Each line's kitchen step, when it reached the kitchen, how many units it had then,
 * and its name, note and picture (a removed line is gone from the order), by order line id.
 */
type KitchenState = Record<
	string,
	{
		step: KitchenStep;
		at: string;
		qty?: number;
		name?: string;
		note?: string;
		image?: string | null;
	}
>;

/** The data names of the dishes cancelled since (shop-wide) and of the products that skip the kitchen. */
const CANCELLED_KEY = "kitchen:cancelled";
const SKIP_KEY = "kitchen:skip";

/**
 * The name an order's kitchen steps are kept under in `ctx.data`.
 * @param orderId The order.
 * @returns The data name.
 */
function kitchenKey(orderId: number) {
	return `kitchen:${orderId}`;
}

/**
 * The products that never go to the kitchen (ready-made drinks): the
 * product form's "Send to kitchen" switch, off.
 * @param data The extension's data for the shop.
 * @returns Their ids.
 */
async function skipped(data: ExtensionData) {
	return new Set((await data.get<number[]>(SKIP_KEY)) ?? []);
}

/**
 * Add dishes to the shop's cancelled list, for the Kitchen page.
 * @param data The extension's data for the shop.
 * @param dishes The cancelled dishes, without their id and time.
 */
async function cancel(
	data: ExtensionData,
	dishes: Omit<KitchenCancelled, "id" | "at">[],
) {
	if (!dishes.length) return;
	const list = (await data.get<KitchenCancelled[]>(CANCELLED_KEY)) ?? [];
	const at = new Date().toISOString();
	for (const dish of dishes)
		list.push({ ...dish, id: crypto.randomUUID(), at });
	await data.set(CANCELLED_KEY, list);
}

/** The kitchen's writes, one after the other: an event and the Kitchen page may look at the same bill together. */
let kitchenQueue: Promise<unknown> = Promise.resolve();

/**
 * Bring one open bill's kitchen record up to date, and say what the kitchen shows of it.
 * A line seen for the first time starts as To do, from now: the lines of one
 * round share that time, which makes them one ticket.
 * A line that lost units (a waiter removed them) or is gone is added to the
 * cancelled list, at the step it had (unless it was done already).
 * Lines of products that skip the kitchen never show.
 * @param data The extension's data for the shop.
 * @param order The open order.
 * @param table The table it belongs to.
 * @returns Its lines for the Kitchen page.
 */
function syncKitchen(
	data: ExtensionData,
	order: OrderFull,
	table: string,
): Promise<KitchenItem[]> {
	const run = kitchenQueue.then(async () => {
		const skip = await skipped(data);
		const now = new Date().toISOString();
		const key = kitchenKey(order.id);
		const state = (await data.get<KitchenState>(key)) ?? {};
		let changed = false;
		const lines = order.items.filter(
			(line) => line.product_id == null || !skip.has(line.product_id),
		);
		const gone: Omit<KitchenCancelled, "id" | "at">[] = [];
		for (const [id, seen] of Object.entries(state)) {
			const was = order.items.find((l) => String(l.id) === id);
			const left = was?.qty ?? 0;
			// units a waiter took off; a dish already done needs no warning
			if (seen.qty != null && left < seen.qty && seen.step !== "done")
				gone.push({
					order_id: order.id,
					table,
					name: was?.name ?? seen.name ?? "",
					qty: seen.qty - left,
					note: was?.note ?? seen.note ?? "",
					image: was?.image ?? seen.image ?? null,
					step: seen.step,
					round: seen.at,
				});
			// gone from the bill, or its product skips the kitchen now: forget it
			if (!lines.some((l) => String(l.id) === id)) {
				delete state[id];
				changed = true;
			} else if (seen.qty !== left) {
				seen.qty = left;
				changed = true;
			}
		}
		await cancel(data, gone);
		const items: KitchenItem[] = [];
		for (const line of lines) {
			if (!state[line.id]) {
				state[line.id] = {
					step: "todo",
					at: now,
					qty: line.qty,
					name: line.name,
					note: line.note,
					image: line.image,
				};
				changed = true;
			}
			const seen = state[line.id]!;
			if (seen.qty == null) {
				seen.qty = line.qty; // a line from before this kept its count
				changed = true;
			}
			items.push({
				order_id: order.id,
				item_id: line.id,
				table,
				name: line.name,
				qty: line.qty,
				note: line.note,
				image: line.image,
				step: seen.step,
				at: seen.at,
			});
		}
		if (changed) await data.set(key, state);
		return items;
	});
	kitchenQueue = run.catch(() => {});
	return run;
}

/**
 * Forget an order's kitchen record (paid, voided), after any write still on its way.
 * @param data The extension's data for the shop.
 * @param orderId The order.
 */
function forgetKitchen(data: ExtensionData, orderId: number) {
	const run = kitchenQueue.then(() => data.delete(kitchenKey(orderId)));
	kitchenQueue = run.catch(() => {});
	return run;
}

/**
 * Every line of the tables' open bills with its kitchen step, oldest first,
 * and the dishes cancelled since.
 * ponytail: one open-bill lookup per table on each call; a kitchen query in the app if tables grow past ~50.
 * @param ctx The route context.
 * @returns The lines and the cancelled dishes.
 */
async function kitchenAnswer(ctx: RouteContext): Promise<KitchenAnswer> {
	const items: KitchenItem[] = [];
	for (const table of await tablesOf(ctx.data)) {
		const customer = await customerOf(ctx.customers, table);
		const order = customer ? await ctx.orders.openFor(customer.id) : null;
		if (order) items.push(...(await syncKitchen(ctx.data, order, table)));
	}
	return {
		items: items.sort((a, b) => a.at.localeCompare(b.at)),
		cancelled: (await ctx.data.get<KitchenCancelled[]>(CANCELLED_KEY)) ?? [],
	};
}

/**
 * An order changed: when it is a table's open bill, its new lines reach the
 * kitchen now (their round's time), and removed ones are cancelled now —
 * whether or not the Kitchen page is open.
 * @param order The order after the change.
 * @param data The extension's data for the shop.
 */
async function orderChanged(order: OrderFull, data: ExtensionData) {
	if (order.status !== "completed" || order.payment_status === "paid") return;
	const name = order.customer?.name.trim().toLowerCase();
	const table = (await tablesOf(data)).find((t) => t.toLowerCase() === name);
	if (table) await syncKitchen(data, order, table);
}

/**
 * Staff routes, at `/ext/restaurant/…`.
 */
export const routes: Routes = {
	/**
	 * The Kitchen page's lines.
	 */
	"GET /kitchen": (ctx) => kitchenAnswer(ctx),

	/**
	 * Move a line to another kitchen step (`{ step: "todo" | "preparing" | "done" }`).
	 * Only a line of a table's open bill.
	 */
	"POST /kitchen/:order/:item": async (ctx) => {
		const body = (await ctx.req.json().catch(() => null)) as {
			step?: unknown;
		} | null;
		const step = body?.step as KitchenStep;
		if (!KITCHEN_STEPS.includes(step)) return refused(ctx.t("error.step"));
		const key = kitchenKey(Number(ctx.params.order));
		const state = await ctx.data.get<KitchenState>(key);
		const item = ctx.params.item ?? "";
		// only a line the record really holds, never `__proto__` and the like
		const line = state && Object.hasOwn(state, item) ? state[item] : null;
		if (!state || !line) return refused(ctx.t("error.step"));
		line.step = step;
		await ctx.data.set(key, state);
		return kitchenAnswer(ctx);
	},

	/**
	 * "Got it" on a cancelled dish: it leaves the Kitchen page.
	 */
	"POST /kitchen/cancelled/:id/ack": async (ctx) => {
		const list = (await ctx.data.get<KitchenCancelled[]>(CANCELLED_KEY)) ?? [];
		await ctx.data.set(
			CANCELLED_KEY,
			list.filter((dish) => dish.id !== ctx.params.id),
		);
		return kitchenAnswer(ctx);
	},

	/**
	 * The product form's "Send to kitchen" switch: on unless the product is in the skip list.
	 */
	"GET /products/:id/kitchen": async (ctx) => ({
		on: !(await skipped(ctx.data)).has(Number(ctx.params.id)),
	}),

	/**
	 * Switch "Send to kitchen" for a product (`{ on }`), managers and admins.
	 */
	"POST /products/:id/kitchen": async (ctx) => {
		if (!MANAGERS.includes(ctx.user?.role ?? ""))
			return Response.json(
				{ error: ctx.t("error.forbidden") },
				{ status: 403 },
			);
		const body = (await ctx.req.json().catch(() => null)) as {
			on?: unknown;
		} | null;
		const id = Number(ctx.params.id);
		if (!(await ctx.products.get(id))) return refused(ctx.t("error.product"));
		const skip = await skipped(ctx.data);
		if (body?.on === false) skip.add(id);
		else skip.delete(id);
		await ctx.data.set(SKIP_KEY, [...skip]);
		return { on: !skip.has(id) };
	},

	/**
	 * The Tables page's list.
	 */
	"GET /tables": (ctx) => tablesAnswer(ctx),

	/**
	 * "Move or join tables": the table's bill goes to another table (`{ to }`).
	 * A free table gets the bill; a table with a bill gets one bill of both.
	 * The kitchen keeps the dishes' steps either way.
	 */
	"POST /tables/:name/move": async (ctx) => {
		const body = (await ctx.req.json().catch(() => null)) as {
			to?: unknown;
		} | null;
		const tables = await tablesOf(ctx.data);
		const from = ctx.params.name ?? "";
		const to = String(body?.to ?? "");
		if (!tables.includes(from) || !tables.includes(to) || from === to)
			return refused(ctx.t("error.table"));
		const source = await customerOf(ctx.customers, from);
		const bill = source ? await ctx.orders.openFor(source.id) : null;
		if (!bill) return refused(ctx.t("error.no_bill"));
		const target = await tableCustomer(ctx, to);
		const there = await ctx.orders.openFor(target.id);
		try {
			if (there) {
				await ctx.orders.join!(bill.id, there.id);
				// the dishes keep their steps on the joined bill
				const moved =
					(await ctx.data.get<KitchenState>(kitchenKey(bill.id))) ?? {};
				const kept =
					(await ctx.data.get<KitchenState>(kitchenKey(there.id))) ?? {};
				await ctx.data.set(kitchenKey(there.id), { ...kept, ...moved });
				await ctx.data.delete(kitchenKey(bill.id));
			} else await ctx.orders.move!(bill.id, target.id);
		} catch (error) {
			return refused(error instanceof Error ? error.message : String(error));
		}
		return tablesAnswer(ctx);
	},

	/**
	 * "Pay": money received for the table's bill, like the Sell screen's checkout:
	 * `{ method, received, sales_staff_id }` = the payment method's name, the cents
	 * the guests gave (more than what is due = change, less = a part payment) and the waiter.
	 * A bill paid in full frees the table (and its QR code stops working).
	 * The answer also carries the `order`, to print its receipt.
	 */
	"POST /tables/:name/pay": async (ctx) => {
		const body = (await ctx.req.json().catch(() => null)) as {
			method?: string;
			received?: unknown;
			sales_staff_id?: number | null;
		} | null;
		const name = ctx.params.name ?? "";
		if (!(await tablesOf(ctx.data)).includes(name))
			return refused(ctx.t("error.table"));
		const customer = await customerOf(ctx.customers, name);
		const bill = customer ? await ctx.orders.openFor(customer.id) : null;
		if (!bill) return refused(ctx.t("error.no_bill"));
		try {
			const received = Number(body?.received);
			await ctx.orders.pay(bill.id, {
				amount: Math.min(received, bill.total - (bill.paid - bill.change)),
				tendered: received,
				payment_method: body?.method,
				sales_staff_id: body?.sales_staff_id ?? null,
			});
		} catch (error) {
			return refused(error instanceof Error ? error.message : String(error));
		}
		// the order as it is now, for the receipt
		return {
			...(await tablesAnswer(ctx)),
			order: await ctx.orders.get(bill.id),
		};
	},

	/**
	 * The Pay dialog's discount box: a percent / fixed discount or a discount code
	 * for the table's bill, or none to take it off (`{ type, value, coupon }` → `orders.setDiscount`).
	 * The same rules as the Sell screen's discount.
	 */
	"POST /tables/:name/discount": async (ctx) => {
		const body = (await ctx.req.json().catch(() => null)) as {
			type?: "percent" | "fixed" | null;
			value?: unknown;
			coupon?: unknown;
		} | null;
		const name = ctx.params.name ?? "";
		if (!(await tablesOf(ctx.data)).includes(name))
			return refused(ctx.t("error.table"));
		const customer = await customerOf(ctx.customers, name);
		const bill = customer ? await ctx.orders.openFor(customer.id) : null;
		if (!bill) return refused(ctx.t("error.no_bill"));
		try {
			await ctx.orders.setDiscount(bill.id, {
				discount_type: body?.type ?? null,
				discount_value: Number(body?.value) || 0,
				...(body?.coupon ? { coupon: String(body.coupon) } : {}),
			});
		} catch (error) {
			return refused(error instanceof Error ? error.message : String(error));
		}
		return tablesAnswer(ctx);
	},

	/**
	 * "Save changes" under a table's bill: the drafted units leave it in one go
	 * (`{ items: [{ order_item_id, qty }] }` → `orders.remove`, one history row).
	 * Their stock goes back, and the kitchen is told through the `order.updated` listener.
	 * The last item of a bill can not be removed: the app refuses and says to void the order.
	 */
	"POST /tables/:name/items/remove": async (ctx) => {
		const body = (await ctx.req.json().catch(() => null)) as {
			items?: { order_item_id: number; qty: number }[];
		} | null;
		const name = ctx.params.name ?? "";
		if (!(await tablesOf(ctx.data)).includes(name))
			return refused(ctx.t("error.table"));
		const customer = await customerOf(ctx.customers, name);
		const bill = customer ? await ctx.orders.openFor(customer.id) : null;
		if (!bill) return refused(ctx.t("error.no_bill"));
		try {
			await ctx.orders.remove(bill.id, { items: body?.items ?? [] });
		} catch (error) {
			return refused(error instanceof Error ? error.message : String(error));
		}
		return tablesAnswer(ctx);
	},

	/**
	 * "Add tables" (managers and admins): names, `5` or a range `1-30`.
	 * Each new table becomes a customer at once, so the Sell screen can pick it.
	 */
	"POST /tables": async (ctx) => {
		if (!MANAGERS.includes(ctx.user?.role ?? ""))
			return Response.json(
				{ error: ctx.t("error.forbidden") },
				{ status: 403 },
			);
		const body = (await ctx.req.json().catch(() => null)) as {
			names?: unknown;
		} | null;
		const asked = parseTables(String(body?.names ?? ""), (n) =>
			ctx.t("table.numbered", { n }),
		);
		const tables = await tablesOf(ctx.data);
		const known = new Set(tables.map((t) => t.toLowerCase()));
		const added = asked.filter((name) => !known.has(name.toLowerCase()));
		if (!added.length) return refused(ctx.t("error.no_new_tables"));
		if (tables.length + added.length > MAX_TABLES)
			return refused(ctx.t("error.too_many", { max: MAX_TABLES }));
		for (const name of added) await tableCustomer(ctx, name);
		await ctx.data.set("tables", [...tables, ...added]);
		return tablesAnswer(ctx);
	},

	/**
	 * "Remove" a table (managers and admins). Its customer and orders stay;
	 * its QR code stops working. A table with an open bill is refused.
	 */
	"DELETE /tables/:name": async (ctx) => {
		if (!MANAGERS.includes(ctx.user?.role ?? ""))
			return Response.json(
				{ error: ctx.t("error.forbidden") },
				{ status: 403 },
			);
		const name = ctx.params.name ?? "";
		const tables = await tablesOf(ctx.data);
		if (!tables.includes(name)) return refused(ctx.t("error.table"));
		const customer = await customerOf(ctx.customers, name);
		if (customer && (await ctx.orders.openFor(customer.id)))
			return refused(ctx.t("error.open_bill"));
		await ctx.data.set(
			"tables",
			tables.filter((t) => t !== name),
		);
		await ctx.data.delete(qrKey(name));
		return tablesAnswer(ctx);
	},

	/**
	 * "New QR code": a fresh token for the table. Every older code stops working.
	 */
	"POST /tables/:name/qr": async (ctx) => {
		const name = ctx.params.name ?? "";
		if (!(await tablesOf(ctx.data)).includes(name))
			return refused(ctx.t("error.table"));
		await tableCustomer(ctx, name); // so the Sell screen and the guest's order find it
		const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
		const qr: TableQr = {
			token: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
			made_at: new Date().toISOString(),
		};
		await ctx.data.set(qrKey(name), qr);
		return qrOf(ctx, name, qr);
	},

	/**
	 * "Rename" on the Table setup tab (managers and admins): the table gets a new
	 * name (`{ to }`), and so does the customer it is. Its bill, its kitchen
	 * tickets and its place in the list stay. Its QR code is kept under the new
	 * name, but the link holds the name: a printed code must be printed again.
	 */
	"POST /tables/:name/rename": async (ctx) => {
		if (!MANAGERS.includes(ctx.user?.role ?? ""))
			return Response.json(
				{ error: ctx.t("error.forbidden") },
				{ status: 403 },
			);
		const body = (await ctx.req.json().catch(() => null)) as {
			to?: unknown;
		} | null;
		const name = ctx.params.name ?? "";
		const to = String(body?.to ?? "").trim();
		const tables = await tablesOf(ctx.data);
		if (!tables.includes(name)) return refused(ctx.t("error.table"));
		if (!to || to.length > MAX_NAME) return refused(ctx.t("error.name"));
		if (to === name) return tablesAnswer(ctx);
		const same = to.toLowerCase();
		if (tables.some((t) => t !== name && t.toLowerCase() === same))
			return refused(ctx.t("error.no_new_tables"));
		try {
			const customer = await customerOf(ctx.customers, name);
			if (customer)
				await ctx.customers.update(customer.id, {
					name: to,
					phone: customer.phone,
					email: customer.email,
					note: customer.note,
				});
		} catch (error) {
			return refused(error instanceof Error ? error.message : String(error));
		}
		await ctx.data.set(
			"tables",
			tables.map((t) => (t === name ? to : t)),
		);
		const qr = await ctx.data.get<TableQr>(qrKey(name));
		if (qr) await ctx.data.set(qrKey(to), qr);
		await ctx.data.delete(qrKey(name));
		return tablesAnswer(ctx);
	},

	/**
	 * "Print bill": the table's open order as it is now, for the app's own
	 * receipt (it prints what is still due while the bill is not paid).
	 */
	"GET /tables/:name/bill": async (ctx) => {
		const name = ctx.params.name ?? "";
		if (!(await tablesOf(ctx.data)).includes(name))
			return refused(ctx.t("error.table"));
		const customer = await customerOf(ctx.customers, name);
		const bill = customer ? await ctx.orders.openFor(customer.id) : null;
		if (!bill) return refused(ctx.t("error.no_bill"));
		return ctx.orders.get(bill.id);
	},

	/**
	 * "Remove QR code": the table has no code any more, so its link stops working
	 * at once. The table and its bill stay.
	 */
	"DELETE /tables/:name/qr": async (ctx) => {
		const name = ctx.params.name ?? "";
		if (!(await tablesOf(ctx.data)).includes(name))
			return refused(ctx.t("error.table"));
		await ctx.data.delete(qrKey(name));
		return tablesAnswer(ctx);
	},
};

/**
 * Storefront routes, at `/store/<slug>/ext/restaurant/…`. No login:
 * the token from the table's current QR code is the proof.
 */
export const publicRoutes: Routes = {
	/**
	 * The table's open bill, for the guest.
	 */
	"GET /bill": async (ctx) => {
		const q = ctx.url.searchParams;
		const table = await tableOf(ctx, q.get("table"), q.get("t"));
		if (!table) return refused(ctx.t("error.table"));
		const customer = await customerOf(ctx.customers, table);
		return billOf(
			table,
			customer ? await ctx.orders.openFor(customer.id) : null,
		);
	},

	/**
	 * "Send to kitchen": the cart joins the table's open order, or opens one.
	 * Prices and stock are the app's own rules; a refusal comes back as text.
	 */
	"POST /order": async (ctx) => {
		const body = (await ctx.req.json().catch(() => null)) as {
			table?: unknown;
			t?: unknown;
			items?: OrderLine[];
		} | null;
		const table = await tableOf(ctx, body?.table, body?.t);
		if (!table) return refused(ctx.t("error.table"));
		const items = Array.isArray(body?.items) ? body.items : [];
		if (!items.length) return refused(ctx.t("error.empty"));
		try {
			const customer = await tableCustomer(ctx, table);
			const open = await ctx.orders.openFor(customer.id);
			const order = open
				? await ctx.orders.add(open.id, { items })
				: await ctx.orders.create({
						items,
						customer_id: customer.id,
						note: table,
					});
			return billOf(table, order);
		} catch (error) {
			// out of stock, a product that is gone: the app's own message
			return refused(error instanceof Error ? error.message : String(error));
		}
	},
};

/**
 * Events.
 */
export default {
	/**
	 * A new round on a table's bill, or lines taken off it: the kitchen
	 * hears of it now, whether or not its page is open.
	 */
	"order.created": ({ order, data }) => orderChanged(order, data),
	"order.updated": ({ order, data }) => orderChanged(order, data),

	/**
	 * A table's bill is paid in full: its QR code stops working,
	 * so the next guests need a new one from the staff.
	 */
	"order.paid": async ({ order, data }) => {
		await forgetKitchen(data, order.id);
		// by the table's name, not a customer id: a table's customer may have been deleted and made again
		const name = order.customer?.name.trim().toLowerCase();
		if (!name) return;
		for (const table of await tablesOf(data))
			if (table.toLowerCase() === name) await data.delete(qrKey(table));
	},

	/**
	 * A voided order leaves the kitchen.
	 */
	"order.voided": async ({ order, data }) => {
		// what was still to cook is cancelled: the kitchen sees it at once
		const state = (await data.get<KitchenState>(kitchenKey(order.id))) ?? {};
		const table = order.customer?.name ?? "";
		await cancel(
			data,
			order.items
				.filter((line) => state[line.id] && state[line.id]!.step !== "done")
				.map((line) => ({
					order_id: order.id,
					table,
					name: line.name,
					qty: line.qty,
					note: line.note,
					step: state[line.id]!.step,
					round: state[line.id]!.at,
				})),
		);
		await forgetKitchen(data, order.id);
	},
} satisfies Listeners;
