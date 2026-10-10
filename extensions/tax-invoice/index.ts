/**
 * Tax Invoice.
 * A tax invoice for a paid order, with the buyer's name, address and tax ID.
 * It is for any country: a tax ID is free text, no format is checked.
 * The server half keeps the seller's details and remembers the buyer per
 * order, so a reprint is the same paper.
 * The invoice number is the prefix and the order's public code.
 * The invoice itself is drawn and printed in the browser.
 * Kept in `ctx.data`: `invoice:<order id>` = the invoice of that order.
 */
import type { Config, RouteContext, Routes } from "../types";
import {
	type Answer,
	DEFAULT_PREFIX,
	type Invoice,
	type Party,
	invoiceNumber,
	refusal,
	savedAddress,
	TEXT_MAX,
} from "./assets/utils.ts";

/**
 * The name an order's invoice is kept under.
 * @param id The order id.
 * @returns The name in `ctx.data`.
 */
function invoiceKey(id: number) {
	return `invoice:${id}`;
}

/**
 * Read one text setting or one text of the form.
 * @param value What was stored or sent.
 * @returns The text, trimmed and cut to the longest allowed.
 */
function text(value: unknown) {
	return String(value ?? "")
		.trim()
		.slice(0, TEXT_MAX);
}

/**
 * The seller, from the settings.
 * @param config The extension's settings.
 * @returns The seller as the invoice prints it.
 */
function sellerOf(config: Config): Party {
	return {
		name: text(config.seller_name),
		address: text(config.seller_address),
		tax_id: text(config.seller_tax_id),
		branch: text(config.seller_branch),
	};
}

/**
 * Answer a request that can't be done.
 * @param message The reason, for the person.
 * @returns A 422 answer.
 */
function refuse(message: string) {
	return Response.json({ error: message }, { status: 422 });
}

/**
 * Issue the invoice of an order, or change the buyer on the one it has.
 * The number and the date of an issued invoice never change.
 * @param ctx The route's context.
 * @returns The seller and the invoice, or a 422 with the reason.
 */
async function issue(ctx: RouteContext) {
	const id = Number(ctx.params.id);
	const order = await ctx.orders.get(id);
	if (!order) return Response.json({ error: "Not found" }, { status: 404 });
	const why = refusal(order);
	if (why) return refuse(ctx.t(why));
	const body = (await ctx.req
		.json()
		.catch(() => null)) as Partial<Party> | null;
	const buyer: Party = {
		name: text(body?.name),
		address: text(body?.address),
		tax_id: text(body?.tax_id),
		branch: text(body?.branch),
	};
	if (!buyer.name || !buyer.address) return refuse(ctx.t("refuse.buyer"));
	const old = await ctx.data.get<Invoice>(invoiceKey(id));
	const invoice: Invoice = {
		number:
			old?.number ??
			invoiceNumber(text(ctx.config.prefix) || DEFAULT_PREFIX, order),
		issued_at: old?.issued_at ?? new Date().toISOString(),
		buyer,
	};
	await ctx.data.set(invoiceKey(id), invoice);
	return { seller: sellerOf(ctx.config), invoice } satisfies Answer;
}

/**
 * Staff routes, served under `/ext/tax-invoice/…`. Every role may use them.
 */
export const routes: Routes = {
	/**
	 * The seller, the invoice this order already has (or null), and the
	 * order's customer to start the buyer form with: the name and the saved
	 * addresses to pick from, each with its tax ID.
	 */
	"GET /orders/:id": async ({ params, config, data, orders, customers }) => {
		const id = Number(params.id);
		const order = await orders.get(id);
		const customer = order?.customer_id
			? await customers.get(order.customer_id)
			: null;
		return {
			seller: sellerOf(config),
			invoice: await data.get<Invoice>(invoiceKey(id)),
			customer: customer && { name: customer.name },
			addresses: customer
				? (await customers.addresses(customer.id)).map(savedAddress)
				: [],
		} satisfies Answer;
	},
	/**
	 * Issue the invoice with the buyer in the body:
	 * `{ name, address, tax_id, branch }`.
	 */
	"POST /orders/:id": issue,
};

/**
 * The event listeners of this extension.
 * There are none: it only serves the routes above.
 */
export default {};
