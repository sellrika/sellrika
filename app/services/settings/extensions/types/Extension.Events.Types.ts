import type { ApiFunction } from "@xcore/api/ApiCall";
import type { ExtensionTranslate } from "@xcore/extensions/ExtensionI18n";
import type { Shop } from "@models/Shop";
import type { User } from "@models/User";
import type { OrderFull, Refund } from "@models/Order";
import type { Product } from "@models/Product";
import type { Customer } from "@models/Customer";
import type { StockMovement, StockUnit } from "@models/Stock";
import type { ExtensionEvent } from "@constants/Extension.Constant";
import type { ReportChannel } from "@constants/Report.Constant";
import type { Summary } from "@services/sales/Report.Service";
import type { DataRow } from "@repositories/Extension.Repository";
import type { Paged } from "@xcore/http/Paginate";
import type { Config } from "./Extension.Types";

/**
 * A staff account as extensions see it.
 * The password hash is never handed out.
 */
export type Staff = Omit<User, "password_hash" | "email_verified_at">;

/**
 * What every event hands its listeners.
 * The shop and the decrypted settings come on top of this.
 * To add an event: a key in `EXTENSION_EVENTS`, its data here and in
 * `extensions/types.ts`, then `emit()` it where it happens.
 */
export type ExtensionEvents = {
	/**
	 * A POS sale was rung up, or an online checkout turned into an order.
	 */
	"order.created": { order: OrderFull };
	/**
	 * Anything changed on an order after it was made.
	 * A delivery stage, a tracking number, a payment, a refund, a void.
	 */
	"order.updated": { order: OrderFull };
	/**
	 * One of the three statuses moved.
	 */
	"order.status_changed": {
		order: OrderFull;
		field: "status" | "fulfillment" | "payment_status";
		from: string;
		to: string;
	};
	/**
	 * The order is fully paid.
	 * At once for a POS sale or a gateway, else when the last payment came in.
	 */
	"order.paid": { order: OrderFull };
	/**
	 * Money was given back, in part or in whole.
	 */
	"order.refunded": { order: OrderFull; refund: Refund };
	/**
	 * The order was cancelled and its stock put back.
	 */
	"order.voided": { order: OrderFull; reason: string };
	"product.created": { product: Product };
	"product.updated": { product: Product };
	/**
	 * The product is gone. `product` is the row as it was.
	 */
	"product.deleted": { product: Product };
	"customer.created": { customer: Customer };
	"customer.updated": { customer: Customer };
	/**
	 * The customer is gone. `customer` is the row as it was.
	 */
	"customer.deleted": { customer: Customer };
	/**
	 * One row of the stock ledger: a sale, a restock, a void, an adjustment.
	 * `unit` is the product or variant as it stands after the move.
	 */
	"stock.updated": { movement: StockMovement; unit: StockUnit };
	/**
	 * Staff is account-wide, so these fire for every shop.
	 */
	"staff.created": { user: Staff };
	"staff.updated": { user: Staff };
	"staff.deleted": { user: Staff };
	/**
	 * The shop's daily sales report is due (the time it picked on /reports).
	 * `report` is the shop's day so far.
	 * `channels` are the chat channels the shop wants it on.
	 */
	"report.daily": {
		report: {
			/** The shop's day, `YYYY-MM-DD`. */
			date: string;
			summary: Summary;
			top_products: { name: string; qty: number; revenue: number }[];
			by_method: { method: string; orders: number; sales: number }[];
		};
		channels: ReportChannel[];
	};
};

/**
 * The API's routes as functions, by area (`products.create`, `orders.pay`…).
 * They come from `ApiCall.functions` in `@xcore/api/ApiCall`.
 * The typed view of them for authors is `ApiFunctions` in `extensions/types.ts`.
 */
export type ExtensionFunctions = Record<string, Record<string, ApiFunction>>;

/**
 * What a listener is called with.
 * The shop, its settings, its dictionary and the event's own data.
 */
export type ExtensionContext<E extends ExtensionEvent> = {
	shop: Shop;
	config: Config;
	/**
	 * The extension's own dictionary (`i18n/<locale>.ts`).
	 * In the language of the request that caused the event.
	 */
	t: ExtensionTranslate;
	locale: string;
	/** The small data the extension keeps for this shop (`extension_data`). */
	data: {
		get: (name: string) => Promise<unknown>;
		set: (name: string, value: unknown) => Promise<void>;
		delete: (name: string) => Promise<void>;
		/** A list that grows, one row per record (`extension_rows`). */
		collection: (name: string) => {
			add: (value: unknown, ref?: string) => Promise<number>;
			get: (id: number) => Promise<DataRow | null>;
			list: (query?: {
				ref?: string;
				page?: number;
				per_page?: number;
			}) => Promise<Paged<DataRow>>;
			update: (id: number, value: unknown) => Promise<void>;
			delete: (id: number) => Promise<void>;
			clear: (ref: string) => Promise<void>;
		};
		/** Runs jobs with the same name one after another. */
		lock: <T>(name: string, job: () => Promise<T>) => Promise<T>;
	};
	/** A checked `fetch` for an address the admin typed (`Outbound.send`). */
	outbound: (url: string, init?: RequestInit) => Promise<Response>;
	/**
	 * Email a customer of the shop a short note (`ExtensionMail`).
	 * It answers null when sent, else why not.
	 */
	mail: {
		customer: (
			id: number,
			note: { subject: string; text: string },
		) => Promise<string | null>;
	};
} & ExtensionEvents[E];

/**
 * One extension listening for an event right now.
 * Its settings, its dictionary and the function to call.
 */
export type ExtensionListener<E extends ExtensionEvent> = {
	key: string;
	config: Config;
	t: ExtensionTranslate;
	fn: (ctx: ExtensionContext<E>) => Promise<void>;
};
