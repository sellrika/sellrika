/**
 * The contract between the POS and an extension.
 * Import these types in your extension for autocomplete:
 * `import type { Listeners, Routes, PageScript, SlotScript } from "../types";`
 * The manifest (extension.json) is described in the extension guide.
 */
import type { Shop } from "@models/Shop";
import type { User } from "@models/User";
import type { OrderDetail, OrderFull, Refund } from "@models/Order";
import type { Product, ProductFull } from "@models/Product";
import type { Customer, CustomerAddress } from "@models/Customer";
import type { StockMovement, StockUnit } from "@models/Stock";
import type { StoreExtensionApi } from "@resources/js/store/types";
import type { z } from "zod";
import type { ApiSchemas } from "@validators/ApiResponse.Validator";
import type {
	CouponQuery,
	OrderQuery,
	PageQuery,
	PeriodQuery,
	ProductQuery,
	ReportQuery,
	StockMovementQuery,
	StockQuery,
} from "@validators/ApiQuery.Validator";
import type { CategoryInput } from "@validators/Category.Validator";
import type { CouponInput } from "@validators/Coupon.Validator";
import type {
	AbandonedInput,
	CampaignInput,
	ScheduleInput,
} from "@validators/Marketing.Validator";
import type {
	FulfillmentInput,
	OrderCreateInput,
	OrderItemsInput,
	PaymentInput,
	RefundInput,
	OrderDiscountInput,
	RemoveItemsInput,
	VoidInput,
} from "@validators/Order.Validator";
import type { PaymentMethodInput } from "@validators/PaymentMethod.Validator";
import type { ProductInput } from "@validators/Product.Validator";
import type { SalesStaffInput } from "@validators/SalesStaff.Validator";
import type { StockAdjustInput } from "@validators/Stock.Validator";

/**
 * The POS row types an extension works with.
 * They are passed through so you can import them from here.
 */
/**
 * Sends a request to an address the shop's admin typed, a webhook for example.
 * Use it instead of `fetch` for such an address:
 * it refuses an address inside the server's own network, and never
 * follows a redirect.
 * @param url The address (http or https).
 * @param init The usual fetch options.
 * @returns The response. It throws when the address is not allowed.
 */
export type Outbound = (url: string, init?: RequestInit) => Promise<Response>;

export type {
	Shop,
	User,
	OrderDetail,
	OrderFull,
	Refund,
	Product,
	ProductFull,
	Customer,
	CustomerAddress,
	StockMovement,
	StockUnit,
	StoreExtensionApi,
};
/**
 * A staff account as extensions see it.
 * The password hash is never part of it.
 */
export type Staff = Omit<User, "password_hash">;

/**
 * One setting the admin filled in on /extensions, with secrets decrypted.
 * The field's `type` in the manifest decides the shape:
 * text / url / select → string, number → number,
 * switch / checkbox → boolean, multiselect → string[].
 */
export type ConfigValue = string | number | boolean | string[];
/**
 * Every setting of one extension, by field name.
 * A `list` field holds rows keyed by its own sub-field names.
 */
export type Config = Record<
	string,
	ConfigValue | Record<string, ConfigValue>[]
>;

/**
 * What each event carries, besides `shop` and `config`.
 * Add an event here and in app/constants/Extension.Constant.ts.
 */
export type Events = {
	/**
	 * A sale rang up at the POS, or an online checkout turned into an order.
	 * `payment_ref` is the text your `pos.display` script gave `approve(ref)`
	 * when the sale was paid with your payment method. The app does not
	 * store it: keep the link to the order yourself. It is also on
	 * `order.updated` (a payment recorded later) and on `order.paid`.
	 * It comes from the browser: look it up in your own records first.
	 */
	"order.created": { order: OrderFull; payment_ref?: string };
	/**
	 * Something changed on an existing order.
	 * That is the delivery stage or tracking, a payment recorded,
	 * a refund, or a void.
	 */
	"order.updated": { order: OrderFull; payment_ref?: string };
	/**
	 * One of the order's statuses moved.
	 * `status` goes completed → partially_refunded / refunded / voided.
	 * `fulfillment` walks the shop's delivery steps
	 * (built in: new → packing → shipped → delivered; a shop may add its own).
	 * `payment_status` goes unpaid → partial → paid.
	 */
	"order.status_changed": {
		order: OrderFull;
		field: "status" | "fulfillment" | "payment_status";
		from: string;
		to: string;
	};
	/**
	 * The order is fully paid.
	 * That is at once for a POS sale or a gateway checkout, or when the
	 * last manual payment (cash on delivery, bank transfer) is recorded.
	 */
	"order.paid": { order: OrderFull; payment_ref?: string };
	/**
	 * Money went back to the customer, part or all of it.
	 * The refund may also have put stock back.
	 */
	"order.refunded": { order: OrderFull; refund: Refund };
	/**
	 * The order was voided: stock went back, reports ignore it.
	 */
	"order.voided": { order: OrderFull; reason: string };
	/**
	 * A new product was added to the shop.
	 */
	"product.created": { product: Product };
	/**
	 * Saved from the form, or pinned / unpinned as featured.
	 */
	"product.updated": { product: Product };
	/**
	 * The row as it was before it went.
	 */
	"product.deleted": { product: Product };
	/**
	 * A new customer was added to the shop.
	 */
	"customer.created": { customer: Customer };
	/**
	 * A customer's details changed.
	 */
	"customer.updated": { customer: Customer };
	/**
	 * The row as it was before it went.
	 * Their orders survive with no customer.
	 */
	"customer.deleted": { customer: Customer };
	/**
	 * One per stock ledger row.
	 * That is a sale line (qty < 0), a refund's restock, a void, a manual
	 * adjustment, or an opening count typed into the product form.
	 * `movement.type` and `movement.order_id` say why it happened.
	 * `unit` is the product or variant as it is after the row: names,
	 * `stock`, and the product's `low_stock_at`.
	 */
	"stock.updated": { movement: StockMovement; unit: StockUnit };
	/**
	 * A staff account was created.
	 * Staff is account-wide, so these fire for every shop.
	 */
	"staff.created": { user: Staff };
	/**
	 * Name, email, role, active flag or password changed.
	 */
	"staff.updated": { user: Staff };
	/**
	 * A staff account was removed.
	 */
	"staff.deleted": { user: Staff };
	/**
	 * The shop's daily sales report is due.
	 * It fires once a day, at the time the shop picked on the Reports page.
	 * `report` is the shop's day so far, money in cents.
	 * `channels` are the chat channels the shop wants it on.
	 */
	"report.daily": { report: DailyReport; channels: string[] };
};

/**
 * The sales of one day of a shop, as `report.daily` carries them.
 */
export type DailyReport = {
	/** The shop's day, `YYYY-MM-DD`. */
	date: string;
	summary: {
		orders: number;
		items: number;
		/** The sum of the order totals. */
		sales: number;
		discounts: number;
		tax: number;
		refunds: number;
		/** Sales minus refunds. */
		revenue: number;
		profit: number;
		avg_order: number;
	};
	/** The best sellers of the day, most units first. */
	top_products: { name: string; qty: number; revenue: number }[];
	by_method: { method: string; orders: number; sales: number }[];
};

/**
 * Looks a text up in your own dictionary (`i18n/<locale>.ts`).
 * See README › Languages.
 * English is used when the language or the key is missing.
 * The key itself comes back when English lacks it too.
 * @param key The dictionary key, for example `"log.order"`.
 * @param params Values put into the text's `{placeholders}`.
 * @returns The text in the current language.
 */
export type Translate = (
	key: string,
	params?: Record<string, string | number>,
) => string;

/**
 * Small data you keep for yourself, per shop: `ctx.data` in routes and listeners.
 * Only your extension sees it. Values are any JSON.
 * `get` / `set` / `delete` are for a few values (a token per table).
 * A list that grows without end (a history, reviews) goes in a `collection`.
 */
export type ExtensionData = {
	/**
	 * Reads a value.
	 * @param name Your name for it.
	 * @returns The value, or null when none is kept.
	 */
	get: <T = unknown>(name: string) => Promise<T | null>;
	/**
	 * Keeps a value, replacing the old one.
	 * @param name Your name for it.
	 * @param value Any JSON value.
	 */
	set: (name: string, value: unknown) => Promise<void>;
	/**
	 * Forgets a value.
	 * @param name Your name for it.
	 */
	delete: (name: string) => Promise<void>;
	/**
	 * A list of records that may grow without end, one row each.
	 * @param name Your name for the list, like `"history"`.
	 * @returns The list's functions. See `Collection`.
	 */
	collection: <T = unknown>(name: string) => Collection<T>;
	/**
	 * Runs jobs with the same name one after another, never at the same time.
	 * Use it around "read, change, save": two orders paid in the same moment
	 * must not both read the old value.
	 * Jobs with different names still run side by side.
	 * @param name What the jobs must not overlap on, like `"customer:12"`.
	 * @param job The work.
	 * @returns What the job returns (or throws).
	 */
	lock: <T>(name: string, job: () => Promise<T>) => Promise<T>;
};

/**
 * One record of a `Collection`.
 */
export type CollectionRow<T = unknown> = {
	/**
	 * The record's number. Newer records have a bigger one.
	 */
	id: number;
	/**
	 * The lookup key you gave it, "" when none.
	 */
	ref: string;
	/**
	 * The record itself.
	 */
	value: T;
	created_at: string;
	updated_at: string;
};

/**
 * A list of records you keep for this shop: `ctx.data.collection(name)`.
 * Only your extension sees it. Each record is any JSON value.
 * You can look records up by their `id` or by one `ref`, a text you pick
 * when you add the record (`"customer:12"`). Nothing inside the value can
 * be searched, so put what you search by in `ref`.
 */
export type Collection<T = unknown> = {
	/**
	 * Adds a record.
	 * @param value Any JSON value.
	 * @param ref The lookup key, like `"product:12"`. Left out = "".
	 * @returns The new record's id.
	 */
	add: (value: T, ref?: string) => Promise<number>;
	/**
	 * Reads one record.
	 * @param id The record's id.
	 * @returns The record, or null when the list has none with that id.
	 */
	get: (id: number) => Promise<CollectionRow<T> | null>;
	/**
	 * Reads one page of the list, newest first.
	 * @param query `ref` = only the records with that lookup key,
	 * `page` from 1, `per_page` up to 100 (20 when left out).
	 * @returns The page with its counts.
	 */
	list: (query?: {
		ref?: string;
		page?: number;
		per_page?: number;
	}) => Promise<Paged<CollectionRow<T>>>;
	/**
	 * Replaces the value of one record. Its `ref` stays.
	 * @param id The record's id.
	 * @param value The new value.
	 */
	update: (id: number, value: T) => Promise<void>;
	/**
	 * Deletes one record.
	 * @param id The record's id.
	 */
	delete: (id: number) => Promise<void>;
	/**
	 * Deletes every record with one lookup key.
	 * @param ref The lookup key.
	 */
	clear: (ref: string) => Promise<void>;
};

/**
 * Email from your extension: `ctx.mail`.
 * You can write only to a customer of the shop, by id. You never pick
 * an address.
 */
export type ExtensionMail = {
	/**
	 * Sends a customer a short note in the shop's name.
	 * The text is plain: each line becomes a paragraph, HTML is not read.
	 * Nothing is sent to a customer with no email, or one who
	 * unsubscribed from the shop's emails, or while email is not set up.
	 * It never throws.
	 * @param id The customer id.
	 * @param note The subject (at most 200 characters) and the text
	 * (at most 5000).
	 * @returns Null when it was sent, else why not.
	 */
	customer: (
		id: number,
		note: { subject: string; text: string },
	) => Promise<string | null>;
};

/**
 * The entry module's default export: one async function per event.
 * Throw to report a failure.
 * It is logged and never shown to a customer.
 */
export type Listeners = {
	[E in keyof Events]?: (
		ctx: {
			shop: Shop;
			config: Config;
			t: Translate;
			locale: string;
			data: ExtensionData;
			/** A checked `fetch` for an address the admin typed. See `Outbound`. */
			outbound: Outbound;
			/** Email a customer of the shop. See `ExtensionMail`. */
			mail: ExtensionMail;
		} & ApiFunctions &
			Events[E],
	) => Promise<void> | void;
};

/**
 * A refused function, thrown by every function of `ApiFunctions`.
 * It is an `Error` whose `name` is "ApiError", with the API's own error on it.
 * Its `message` can be shown to the person.
 */
export type ApiError = Error & {
	/**
	 * The HTTP status the API route answers: 403, 404, 422…
	 */
	status: number;
	/**
	 * The API's error type: `forbidden`, `not_found`, `validation_error`…
	 */
	type: string;
	/**
	 * For a refused input: the message per field.
	 */
	fields?: Record<string, string>;
};

/**
 * One answer of the REST API, by its name in the API docs (`/api/docs`).
 */
export type Answer<N extends keyof typeof ApiSchemas> = z.infer<
	(typeof ApiSchemas)[N]
>;
/**
 * One page of a list.
 */
export type Paged<T> = {
	data: T[];
	total: number;
	page: number;
	per_page: number;
	last_page: number;
};
/**
 * The answer of a delete.
 */
export type Deleted = Answer<"Deleted">;

/**
 * Everything the REST API can do, as functions.
 * Each one runs the API route's own code: the same checks, the same rules
 * and the same answer as a call with a key. The API docs (`/api/docs`)
 * describe every input and answer; money is in cents.
 * The path's ids come first, then one object: the body, or for a read the
 * filters (`products.list({ q: "mug", page: 2 })`).
 * Every call is for the shop of the request (or of the event).
 * Who it runs as: on a staff route the signed-in staff member, so their
 * role decides (a cashier can't delete a product). On a public route and
 * in a listener nobody is signed in, so every function is allowed: on a
 * public route check who is asking before you call.
 * A read of one record that is not there gives null.
 * Any other refusal throws an `ApiError`.
 */
export type ApiFunctions = {
	/**
	 * Who the functions run as, and the shop.
	 */
	account: { me: () => Promise<Answer<"Me">> };
	/**
	 * The shop's products.
	 */
	products: {
		list: (
			query?: z.input<typeof ProductQuery>,
		) => Promise<Paged<Answer<"Product">>>;
		get: (id: number) => Promise<Answer<"Product"> | null>;
		create: (input: z.input<typeof ProductInput>) => Promise<Answer<"Product">>;
		/**
		 * An update takes the whole record, like a create.
		 */
		update: (
			id: number,
			input: z.input<typeof ProductInput>,
		) => Promise<Answer<"Product">>;
		delete: (id: number) => Promise<Deleted>;
	};
	/**
	 * The shop's categories.
	 */
	categories: {
		list: () => Promise<Answer<"CategoryWithCount">[]>;
		get: (id: number) => Promise<Answer<"CategoryWithCount"> | null>;
		create: (
			input: z.input<typeof CategoryInput>,
		) => Promise<Answer<"Category">>;
		update: (
			id: number,
			input: z.input<typeof CategoryInput>,
		) => Promise<Answer<"Category">>;
		delete: (id: number) => Promise<Deleted>;
	};
	/**
	 * Stock counts and their history.
	 */
	stock: {
		list: (
			query?: z.input<typeof StockQuery>,
		) => Promise<Paged<Answer<"StockItem">>>;
		summary: () => Promise<Answer<"StockSummary">>;
		movements: (
			query: z.input<typeof StockMovementQuery>,
		) => Promise<Paged<Answer<"StockMovement">>>;
		/**
		 * `delta` adds or removes units, `set` sets the count.
		 */
		adjust: (
			input: z.input<typeof StockAdjustInput>,
		) => Promise<Answer<"StockLevel">>;
	};
	/**
	 * The shop's orders.
	 */
	orders: {
		list: (
			query?: z.input<typeof OrderQuery>,
		) => Promise<Paged<Answer<"Order">>>;
		/**
		 * With `paid` it is a sale, like the till rings up.
		 * Without `paid` the order is written unpaid, to be paid later.
		 */
		create: (input: z.input<typeof OrderCreateInput>) => Promise<OrderDetail>;
		get: (id: number) => Promise<OrderDetail | null>;
		/**
		 * Records money received for an order that is not paid in full.
		 */
		pay: (
			id: number,
			input: z.input<typeof PaymentInput>,
		) => Promise<Answer<"OrderPayment">>;
		/**
		 * Adds lines to an order that is not paid in full yet.
		 */
		add: (
			id: number,
			input: z.input<typeof OrderItemsInput>,
		) => Promise<OrderDetail>;
		/**
		 * Takes units off an order that is not paid in full yet.
		 */
		remove: (
			id: number,
			input: z.input<typeof RemoveItemsInput>,
		) => Promise<OrderDetail>;
		/**
		 * Gives an order that is not paid in full a discount (percent / fixed) or a
		 * discount code, or takes it off (no type and no code). Till orders only.
		 */
		setDiscount: (
			id: number,
			input: z.input<typeof OrderDiscountInput>,
		) => Promise<OrderDetail>;
		setFulfillment: (
			id: number,
			input: z.input<typeof FulfillmentInput>,
		) => Promise<OrderDetail>;
		refund: (
			id: number,
			input: z.input<typeof RefundInput>,
		) => Promise<Answer<"Refund">>;
		void: (
			id: number,
			input?: z.input<typeof VoidInput>,
		) => Promise<OrderDetail>;
	};
	/**
	 * Discount codes.
	 */
	coupons: {
		list: (
			query?: z.input<typeof CouponQuery>,
		) => Promise<Paged<Answer<"CouponWithStats">>>;
		get: (id: number) => Promise<Answer<"CouponWithStats"> | null>;
		create: (input: z.input<typeof CouponInput>) => Promise<Answer<"Coupon">>;
		update: (
			id: number,
			input: z.input<typeof CouponInput>,
		) => Promise<Answer<"Coupon">>;
		delete: (id: number) => Promise<Deleted>;
		/**
		 * The orders that used the code, newest first.
		 */
		redemptions: (
			id: number,
			query?: z.input<typeof PageQuery>,
		) => Promise<Paged<Answer<"CouponRedemption">> | null>;
	};
	/**
	 * The payment methods of the till.
	 */
	paymentMethods: {
		list: () => Promise<Answer<"PaymentMethod">[]>;
		get: (id: number) => Promise<Answer<"PaymentMethod"> | null>;
		create: (
			input: z.input<typeof PaymentMethodInput>,
		) => Promise<Answer<"PaymentMethod">>;
		update: (
			id: number,
			input: z.input<typeof PaymentMethodInput>,
		) => Promise<Answer<"PaymentMethod">>;
		delete: (id: number) => Promise<Deleted>;
	};
	/**
	 * The staff accounts of the shop's owner. Read only.
	 */
	staff: { list: () => Promise<Answer<"Staff">[]> };
	/**
	 * The sales people (no login) and their commission.
	 */
	salesStaff: {
		list: () => Promise<Answer<"SalesStaff">[]>;
		get: (
			id: number,
			query?: z.input<typeof PeriodQuery>,
		) => Promise<Answer<"SalesStaffDetail"> | null>;
		create: (
			input: z.input<typeof SalesStaffInput>,
		) => Promise<Answer<"SalesStaff">>;
		update: (
			id: number,
			input: z.input<typeof SalesStaffInput>,
		) => Promise<Answer<"SalesStaff">>;
		/**
		 * Pays the commission due and writes it to their history.
		 */
		pay: (id: number) => Promise<Answer<"SalesStaff">>;
		delete: (id: number) => Promise<Deleted>;
	};
	/**
	 * The abandoned-cart email and the email campaigns.
	 */
	marketing: {
		abandonedCart: () => Promise<Answer<"AbandonedCart">>;
		setAbandonedCart: (
			input: z.input<typeof AbandonedInput>,
		) => Promise<Answer<"AbandonedCart">>;
		campaigns: (
			query?: z.input<typeof PageQuery>,
		) => Promise<Paged<Answer<"Campaign">>>;
		campaign: (id: number) => Promise<Answer<"Campaign"> | null>;
		createCampaign: (
			input: z.input<typeof CampaignInput>,
		) => Promise<Answer<"Campaign">>;
		updateCampaign: (
			id: number,
			input: z.input<typeof CampaignInput>,
		) => Promise<Answer<"Campaign">>;
		/**
		 * `now: true` sends at once, else `send_at` picks the time.
		 */
		scheduleCampaign: (
			id: number,
			input: z.input<typeof ScheduleInput>,
		) => Promise<Answer<"Campaign">>;
		cancelSchedule: (id: number) => Promise<Answer<"Campaign">>;
		deleteCampaign: (id: number) => Promise<Deleted>;
	};
	/**
	 * The sales report of a period.
	 */
	reports: {
		sales: (query?: z.input<typeof ReportQuery>) => Promise<Answer<"Report">>;
	};
};

/**
 * One line to put on an order.
 */
export type OrderLine = {
	product_id: number;
	/**
	 * The variant, for a product that has variants.
	 */
	variant_id?: number | null;
	qty: number;
	/**
	 * A package's picks: slot id → the variant chosen for that slot.
	 */
	choices?: Record<string, number>;
	/**
	 * A note for this line ("no onions"). Kept as given.
	 */
	note?: string;
};

/**
 * The shop's customers, handed to every route (staff and public).
 * Every call is scoped to the shop of the request.
 * On a public route nobody is signed in: never send a customer's details
 * back to the browser unless you checked who is asking.
 */
export type Customers = {
	/**
	 * Makes a customer with the same rules as the customer form.
	 * A phone number belongs to one customer of the shop only.
	 * It throws with the first failing field.
	 * @param input `name`, and optionally `phone`, `email` and `note`.
	 * @returns The new customer.
	 */
	create: (input: {
		name: string;
		phone?: string | null;
		email?: string | null;
		note?: string;
	}) => Promise<Customer>;
	/**
	 * Changes a customer, with the same rules as the customer form.
	 * It takes the whole record, like `create`.
	 * It throws with the first failing field, or when the customer is gone.
	 * @param id The customer.
	 * @param input `name`, and optionally `phone`, `email` and `note`.
	 * @returns The customer after the change.
	 */
	update: (
		id: number,
		input: {
			name: string;
			phone?: string | null;
			email?: string | null;
			note?: string;
		},
	) => Promise<Customer>;
	/**
	 * Reads one customer of the shop.
	 * @param id The customer id.
	 * @returns The customer, or null when it is not this shop's.
	 */
	get: (id: number) => Promise<Customer | null>;
	/**
	 * Reads the addresses of one customer, oldest first: the ones they keep
	 * on their store account and the ones staff added on their page.
	 * Each may carry a `tax_id` (free text, for invoices).
	 * @param id The customer id.
	 * @returns The addresses. None when the customer is not this shop's.
	 */
	addresses: (id: number) => Promise<CustomerAddress[]>;
	/**
	 * Finds customers by a part of their name or phone.
	 * @param q What to look for.
	 * @returns A handful of matches.
	 */
	search: (q: string) => Promise<Customer[]>;
};

/**
 * What a route handler receives.
 * `user` is there on staff routes only.
 * Everything the REST API can do is there as functions (`ApiFunctions`):
 * `products`, `categories`, `stock`, `orders`, `coupons`, `paymentMethods`,
 * `staff`, `salesStaff`, `marketing`, `reports`, `account`.
 */
export type RouteContext = {
	/**
	 * The incoming request.
	 */
	req: Request;
	/**
	 * The request's URL, already parsed.
	 */
	url: URL;
	/**
	 * The `:name` segments of the route, by name.
	 */
	params: Record<string, string>;
	/**
	 * The shop this request belongs to.
	 */
	shop: Shop;
	/**
	 * The settings the admin filled in for this extension.
	 */
	config: Config;
	/**
	 * Your dictionary in the language of the request.
	 */
	t: Translate;
	/**
	 * That language: `"en"`, `"de"`, and so on.
	 */
	locale: string;
	/**
	 * The signed-in staff member. Staff routes only.
	 */
	user?: User;
	/**
	 * The shop's customers: make one, read one, search by name or phone.
	 */
	customers: Customers;
	/**
	 * The address of the shop's online store, like `https://my-shop.shop.sellrika.com`.
	 * Build links for buyers from it (a QR code, an email).
	 */
	store_url: string;
	/**
	 * Signs a value with the app's secret key, for links nobody should guess.
	 * The same value always gives the same signature, for this extension and this shop only.
	 * Put it in a link, then check it on the way back: `sign(value) === given`.
	 * @param value What to sign: a table name, an id.
	 * @returns The signature, safe in a URL.
	 */
	sign: (value: string) => string;
	/**
	 * Small data you keep for this shop. See `ExtensionData`.
	 */
	data: ExtensionData;
	/**
	 * A checked `fetch` for an address the admin typed. See `Outbound`.
	 */
	outbound: Outbound;
	/**
	 * Email a customer of the shop. See `ExtensionMail`.
	 */
	mail: ExtensionMail;
	/**
	 * HTML a person wrote, made safe to show.
	 */
	html: {
		/**
		 * Cleans HTML with the app's own cleaner, the one product
		 * descriptions pass: scripts, frames, forms and `on…` handlers go,
		 * links keep only http(s), mailto, tel and paths of the site.
		 * Clean what a person typed before you save it.
		 * @param html The HTML from an editor.
		 * @returns The cleaned HTML.
		 */
		clean: (html: string) => Promise<string>;
	};
	/**
	 * The pictures your browser code uploaded (`api.upload`).
	 */
	uploads: {
		/**
		 * Tells the app you stopped using these pictures (a post was
		 * deleted, a cover was replaced). Call it after you saved.
		 * Each one leaves storage when nothing else uses it: not your
		 * data, not a product. Paths of another shop are ignored.
		 * @param urls The `/uploads/…` paths.
		 */
		drop: (urls: string[]) => Promise<void>;
	};
	/**
	 * Store pages only: a request for a page below your manifest's
	 * `storefront.path`, on the host of the shop's online store.
	 */
	storefront?: {
		/**
		 * Sends the page you built: the whole HTML document, with its
		 * own head, header, footer, CSS and scripts. No theme is around it.
		 * It is not cleaned. Put text a person typed through
		 * `html.clean` first.
		 * @param page The page. See `StorePage`.
		 * @returns The response to return from your handler.
		 */
		page: (page: StorePage) => Response;
	};
	/**
	 * Public routes only: the customer signed in to the shop's online
	 * store, or null for a guest. Read it from here, never from the
	 * request: a buyer must not ask for another customer's data.
	 */
	customer?: { id: number; name: string; email: string | null } | null;
} & Omit<ApiFunctions, "products" | "orders"> & {
		/**
		 * The shop's products, plus a lookup by SKU.
		 */
		products: ApiFunctions["products"] & {
			/**
			 * Finds the product that already carries a SKU.
			 * A variant's SKU gives that variant's product.
			 * @param sku The SKU to look for.
			 * @returns The product id, or null when no product carries it.
			 */
			idBySku: (sku: string) => Promise<number | null>;
		};
		/**
		 * The shop's orders, plus a customer's open bill.
		 */
		orders: ApiFunctions["orders"] & {
			/**
			 * Finds the order a customer can still add to: their newest one that
			 * is not paid in full, refunded or voided.
			 * @param customerId The customer.
			 * @returns That order, or null when they have none.
			 */
			openFor: (customerId: number) => Promise<OrderFull | null>;
			/**
			 * What a pay dialog offers, like the Sell screen's checkout: the shop's
			 * payment methods that are switched on (`tendered` = asks for the
			 * cash handed over and shows change; the rows fit `api.paymentPicker`) and its active sales staff.
			 * Every role may read them.
			 * @returns The methods and the sales staff.
			 */
			payOptions: () => Promise<{
				methods: {
					id: number;
					name: string;
					tendered: boolean;
					icon: string;
					image: string | null;
					extension: string | null;
				}[];
				sales_staff: { id: number; name: string }[];
			}>;
			/**
			 * Staff routes only: gives an order that is not paid in full to
			 * another customer (a table's bill moving to another table).
			 * @param orderId The order.
			 * @param customerId The new customer.
			 * @returns The order after it.
			 */
			move?: (orderId: number, customerId: number) => Promise<OrderFull>;
			/**
			 * Staff routes only: joins two orders that are not paid yet. Every line
			 * of `fromId` moves to `intoId`, which is worked out again; `fromId`
			 * is gone. Refused when `fromId` has money received or a discount.
			 * @param fromId The order that goes.
			 * @param intoId The order that stays.
			 * @returns The joined order.
			 */
			join?: (fromId: number, intoId: number) => Promise<OrderFull>;
		};
	};
/**
 * A page of your extension on the shop's online store
 * (`ctx.storefront.page`). You build all of it.
 */
export type StorePage = {
	/**
	 * The whole HTML document: `<!doctype html>`, `<head>` (title, head
	 * tags for search engines, CSS) and `<body>`.
	 * A picture path `/uploads/…` in an `<img src>` loads from the app's
	 * own host.
	 */
	html: string;
	/**
	 * 404 = the page says something is not there. Default 200.
	 */
	status?: 200 | 404;
};

/**
 * What the functions of `export const storefront` get.
 */
export type StorefrontContext = {
	shop: Shop;
	config: Config;
	t: Translate;
	locale: string;
	data: ExtensionData;
};

/**
 * `export const storefront` of the entry module: what your pages add to
 * the shop's online store. The manifest must have `storefront.path`
 * (`"blog"`): your `publicRoutes` then answer `GET /blog` and every path
 * below it on the store's host. A page of the app itself always wins.
 * Both functions run on store requests: keep them to one read of
 * `ctx.data`. One that throws is logged and counts as an empty list.
 */
export type StorefrontHooks = {
	/**
	 * Links for the store's menu and footer, next to the shop's own
	 * pages. At most 5. Each `path` must be your path or below it.
	 * Return none while there is nothing to read.
	 */
	links?: (
		ctx: StorefrontContext,
	) =>
		| Promise<{ title: string; path: string }[]>
		| { title: string; path: string }[];
	/**
	 * Paths for the store's `sitemap.xml`, at most 5000. Each must be
	 * your path or below it.
	 */
	sitemap?: (ctx: StorefrontContext) => Promise<string[]> | string[];
};

/**
 * The route maps an extension exports.
 * `export const routes` are staff routes, at `/ext/<key>/…`.
 * `export const publicRoutes` are storefront routes, at
 * `/store/<slug>/ext/<key>/…`.
 * Keys are `"METHOD /path"`, and `:name` segments become `params`.
 * A handler returns a Response, or any JSON value.
 */
export type Routes = Record<
	string,
	(ctx: RouteContext) => Response | unknown | Promise<Response | unknown>
>;

/**
 * What every page and slot script gets in the browser.
 */
export type Api = {
	/**
	 * The extension's key, as in the manifest.
	 */
	key: string;
	/**
	 * Your dictionary (`i18n/<locale>.ts`) in the page's language.
	 */
	t: Translate;
	/**
	 * That language.
	 */
	locale: string;
	/**
	 * The active shop.
	 */
	shop: Shop;
	/**
	 * The signed-in user: id, name, email, role.
	 */
	user: Pick<User, "id" | "name" | "email" | "role">;
	/**
	 * The extension's staff mount (`/ext/<key>`).
	 */
	base: string;
	/**
	 * `fetch` against the extension's own staff routes, cookies included.
	 * `api.fetch("/items")` calls `GET /ext/<key>/items`.
	 * @param path The path under the extension's mount.
	 * @param init The usual fetch options.
	 * @returns The response.
	 */
	fetch: (path: string, init?: RequestInit) => Promise<Response>;
	/**
	 * Shows a toast in the app's own style.
	 * @param message The text to show.
	 * @param kind How it looks. Defaults to a success toast.
	 */
	toast: (message: string, kind?: "success" | "error" | "info") => void;
	/**
	 * Uploads one picture to the shop's own storage, like a product picture.
	 * Managers and admins only. It is made smaller when it is big.
	 * Keep the path in your data (`ctx.data`): a picture is kept as long
	 * as something there names it. Tell the app when you stop using one
	 * (`ctx.uploads.drop`).
	 * @param file The picture (JPEG, PNG, WebP, GIF or AVIF).
	 * @returns `{ url }` with its path (`/uploads/…`), or `{ error }`
	 * with the text to show.
	 */
	upload: (file: File) => Promise<{ url: string } | { error: string }>;
	/**
	 * Plain DOM elements dressed like the app's own form components.
	 * See the extension guide › Looks like the app.
	 */
	ui: UiKit;
	/**
	 * Opens a dialog in the app's own style.
	 * It has a title, a description, a body element and footer buttons.
	 * Close it with the handle, the X, Escape or the backdrop.
	 * @param opts What the dialog holds and how big it is.
	 * @returns The dialog element, its body, a `close()` and a promise
	 * that resolves once it is closed.
	 */
	dialog: (opts: {
		title: string;
		description?: string;
		body?: HTMLElement | string;
		footer?: HTMLElement[];
		size?: "sm" | "md" | "lg";
		closable?: boolean;
	}) => {
		el: HTMLDialogElement;
		body: HTMLElement;
		close: () => void;
		closed: Promise<void>;
	};
	/**
	 * The app's ⌘K search palette (search-js), lent to you.
	 * It opens with your `placeholder` and `onSearch` answers each
	 * keystroke. Rows are `{ title, description?, …anything }`; title and
	 * description are rendered as HTML, so escape what came from outside.
	 * `onSelected` gets the picked row.
	 * The app's own search is back the moment the palette closes — on a
	 * pick, Escape, the backdrop or `close()`.
	 * `keyword` is typed into the box on open and searched at once, for a
	 * remembered search or something to show before typing.
	 * Nothing is kept in the palette's recent list.
	 * @param opts The placeholder, the first keyword and the callbacks.
	 * @returns A `close()`, and `closed` which resolves with what the box
	 * held.
	 */
	search: <T extends SearchItem>(opts: {
		placeholder?: string;
		keyword?: string;
		onSearch: (keyword: string) => T[] | Promise<T[]>;
		onSelected: (item: T) => void;
	}) => { close: () => void; closed: Promise<string> };
	/**
	 * Prints a slip the way the app prints receipts: the browser's print
	 * window, or the receipt printer through RawBT when the till uses it.
	 * @param slip The big title, the lines under it, and a text to show as
	 * a QR code (a link), printed under the lines.
	 */
	print: (slip: { title: string; lines?: string[]; qr?: string }) => void;
	/**
	 * Prints an order's receipt: the same slip the Sell screen and the order
	 * page print (lines, notes, discount, tax, total, paid, change).
	 * @param order The order, as `orders.get()` answers it in a route.
	 */
	printReceipt: (order: OrderDetail) => void;
	/**
	 * Opens another page of the app without a full page load.
	 * Use it instead of `location.href`: the browser stays full screen.
	 * @param url The page, like `/pos?customer=4`.
	 */
	visit: (url: string) => void;
	/**
	 * Pages only: the right side of the page's heading, next to its title.
	 * Put the page's main buttons there (it hides while empty).
	 */
	actions?: HTMLElement;
	/**
	 * Pages only: a full-height column on the right of the page (400 px wide,
	 * under the content on a phone), for a details panel. It hides while empty.
	 */
	aside?: HTMLElement;
	/**
	 * Draws a QR code as an SVG string, for a link a phone should open.
	 * @param text What the code holds.
	 * @returns The `<svg>` markup.
	 */
	qr: (text: string) => string;
	/**
	 * The app's payment method buttons, for a pay dialog of your own.
	 * They are the Sell screen's own, so every pay dialog looks and works the
	 * same, and the customer's screen shows the picked method (its picture, or
	 * what an extension draws for it) with the amount.
	 * Put `el` in your dialog. Call `setAmount()` when the money asked for
	 * changes, and `destroy()` when the dialog closes or the money is taken.
	 * @param opts.methods The methods on offer.
	 * @param opts.value The one picked first. Default the first of the list.
	 * @param opts.amount The cents the customer is asked for.
	 * @param opts.onChange Called with the method when one is picked.
	 * @param opts.onApproval Called when the picked method's extension
	 * approved the payment (with its reference), and with null when the
	 * method starts or stops waiting for an approval. Set your confirm
	 * button from `blocked()` there. On a reference, confirm your dialog
	 * and send the reference as `payment_ref` to `orders.pay` /
	 * `orders.create`.
	 * @returns The element and its controls. `blocked()` is true while the
	 * picked method still waits for its extension's approval: keep your
	 * confirm button off then. `ref()` is the approval's reference, or null.
	 */
	paymentPicker: <M extends PickerMethod>(opts: {
		methods: M[];
		value?: M | null;
		amount: number;
		onChange?: (method: M) => void;
		onApproval?: (ref: string | null) => void;
	}) => {
		el: HTMLElement;
		value: () => M | null;
		setAmount: (cents: number) => void;
		blocked: () => boolean;
		ref: () => string | null;
		destroy: () => void;
	};
	/**
	 * The app's own text editor, the one product descriptions use: text
	 * styles, lists, tables and pictures. A picture the person adds is
	 * uploaded to the shop's storage (like `api.upload`) and the HTML holds
	 * its `/uploads/…` path, never the picture's data.
	 * Put `el` on your page and call `destroy()` when the page goes.
	 * Clean the HTML on your route before you keep it (`ctx.html.clean`).
	 * @param opts.value The HTML to start with.
	 * @param opts.label The editor's name for screen readers.
	 * @param opts.onChange Called with the HTML after every change.
	 * @returns The element and its controls: `value()` is the HTML now,
	 * `set(html)` replaces it.
	 */
	richText: (opts: {
		value?: string;
		label?: string;
		onChange?: (html: string) => void;
	}) => {
		el: HTMLElement;
		value: () => string;
		set: (html: string) => void;
		destroy: () => void;
	};
};

/**
 * What `api.paymentPicker` needs of a payment method.
 * A whole row of `paymentMethods.list()` fits.
 */
export type PickerMethod = {
	id: number;
	name: string;
	icon?: string;
	/**
	 * The method's picture for the customer's screen, when it has one.
	 */
	image?: string | null;
	/**
	 * The key of the extension that added the method, when one did.
	 */
	extension?: string | null;
};

/**
 * One row of `api.search`.
 * It holds what the palette shows, plus whatever you need back in
 * `onSelected`.
 */
export type SearchItem = {
	/**
	 * The row's first line.
	 */
	title: string;
	/**
	 * The row's second line.
	 */
	description?: string;
	/**
	 * HTML for the row's icon slot, an `<img>` for example.
	 * The list's default icon is used when this is left out.
	 */
	icon?: string;
	/**
	 * Anything else you want handed back in `onSelected`.
	 */
	[key: string]: unknown;
};

/**
 * Attributes set on an element made by `api.ui`.
 */
type Attrs = Record<string, string | number | boolean | undefined>;
/**
 * `api.ui`: each call returns a normal DOM element.
 * You append it and wire it up yourself.
 */
export type UiKit = {
	/**
	 * Makes a `<label>`.
	 * @param text The label text.
	 * @param htmlFor The id of the control it labels.
	 * @returns The label element.
	 */
	label: (text: string, htmlFor?: string) => HTMLLabelElement;
	/**
	 * Makes a text box.
	 * @param attrs Attributes such as `type`, `id`, `placeholder`, `value`.
	 * @returns The input element.
	 */
	input: (attrs?: Attrs) => HTMLInputElement;
	/**
	 * Makes a multi-line text box.
	 * @param attrs Attributes such as `id`, `rows`, `placeholder`.
	 * @returns The textarea element.
	 */
	textarea: (attrs?: Attrs) => HTMLTextAreaElement;
	/**
	 * Makes a native `<select>` in the app's look.
	 * An option with `value: ""` is the placeholder.
	 * @param options The options to offer.
	 * @param attrs Attributes such as `id` and `value`.
	 * @returns The select element.
	 */
	select: (
		options: { value: string; label: string; disabled?: boolean }[],
		attrs?: Attrs,
	) => HTMLSelectElement;
	/**
	 * Makes a checkbox.
	 * @param attrs Attributes such as `id` and `checked`.
	 * @returns The checkbox input.
	 */
	checkbox: (attrs?: Attrs) => HTMLInputElement;
	/**
	 * Makes an on/off switch that looks like the app's own.
	 * It is a checkbox: read `checked`, listen for `change`.
	 * @param attrs Attributes such as `id`, `checked` and `aria-label`.
	 * @returns The switch input.
	 */
	switch: (attrs?: Attrs) => HTMLInputElement;
	/**
	 * Makes a button.
	 * @param text The button text.
	 * @param opts Variant, size and the button's `type`.
	 * @returns The button element.
	 */
	button: (
		text: string,
		opts?: {
			variant?:
				| "default"
				| "outline"
				| "secondary"
				| "ghost"
				| "destructive"
				| "link";
			size?: "default" | "xs" | "sm" | "lg";
			type?: "button" | "submit";
		},
	) => HTMLButtonElement;
	/**
	 * Stacks a label, a control and a muted hint like the app's forms.
	 * @param label The label element.
	 * @param control The control it belongs to.
	 * @param hint A short line under the control.
	 * @returns The wrapper element.
	 */
	field: (
		label: HTMLElement,
		control: HTMLElement,
		hint?: string,
	) => HTMLDivElement;
	/**
	 * Makes the bordered box the app's cards use.
	 * @param children What goes inside the card.
	 * @returns The card element.
	 */
	card: (...children: (HTMLElement | string)[]) => HTMLDivElement;
	/**
	 * Makes a muted line of help text.
	 * @param text The hint text.
	 * @returns The paragraph element.
	 */
	hint: (text: string) => HTMLParagraphElement;
	/**
	 * Makes a line of error text.
	 * @param text The error text.
	 * @returns The paragraph element.
	 */
	error: (text: string) => HTMLParagraphElement;
	/**
	 * Makes a text box with the search icon in it.
	 * That is the sidebar's Search look.
	 * @param attrs Attributes for the box itself.
	 * @returns The wrapper. The box itself is `.input` on it.
	 */
	searchInput: (attrs?: Attrs) => HTMLDivElement & { input: HTMLInputElement };
};

/**
 * The default export of a page script (manifest `pages[].script`).
 * Build the page inside `el`.
 * @param el The element the page mounts in.
 * @param api What the browser side gets from the app.
 * @returns Nothing, or a cleanup to run when the page is left.
 */
export type PageScript = (
	el: HTMLElement,
	api: Api,
) => void | (() => void) | Promise<undefined | (() => void)>;

/**
 * What each slot passes to its script as `api.context`.
 * Add a slot here and in app/constants/Extension.Constant.ts.
 */
export type SlotContexts = {
	/**
	 * The product form, both create and edit.
	 * `values()` gives the form as it is now.
	 * `set()` fills fields; unknown keys are ignored.
	 * Money fields are decimal strings such as "12.50".
	 * `images` is an array of URLs and `description` is HTML.
	 * `extra` is the "Additional data" rows, `[{ title, value }]`.
	 */
	"product.form": {
		values: () => Record<string, unknown>;
		set: (patch: Record<string, unknown>) => void;
	};
	/**
	 * Not a place in the staff app: the script runs on every page of the
	 * shop's online store. Its default export is a `StoreScript`, not a
	 * `SlotScript`, and it gets no element and no context.
	 */
	"store.page": never;
	/**
	 * The product form's side column, under Featured: a small card of your
	 * own for this product (a switch, say). Save it through your own route.
	 * `id` is null while the product is new (not saved yet).
	 */
	"product.side": { id: number | null };
	/**
	 * The order page (`/orders/:id`), in the row of buttons at the top
	 * right, before Print: a button of your own for this order.
	 * `order()` gives the order as the page shows it now, with its lines,
	 * its customer, its refunds and its history. Money is integer cents.
	 * Call it again each time you need it: the order changes while the
	 * page is open (a payment, a refund).
	 * Read only: change the order through your own route.
	 */
	"order.show": { order: () => OrderDetail };
	/**
	 * The printed receipt of an order (the Sell screen after a sale, the
	 * order page). Your script draws nothing: it adds lines of text, which
	 * print over "Thank you" on paper and on a RawBT printer alike.
	 * `order()` gives the order being printed. Money is integer cents.
	 * `add(lines)` adds your lines: `text`, an optional `right` (drawn at
	 * the right edge, like an amount), `bold`, `center`. At most 12 lines
	 * per receipt, 200 characters each.
	 * The script runs again when the order changes (a payment, a refund),
	 * starting from no lines: call `add` once per run.
	 * A receipt printed by `api.printReceipt` prints at once and does not
	 * wait for your lines.
	 */
	"order.receipt": {
		order: () => OrderDetail;
		add: (lines: ReceiptLine[]) => void;
	};
	/**
	 * The Sell screen's cart, under the customer row: a small strip of
	 * your own about who is buying (their points, a reward to use).
	 * Leave your element empty while you have nothing to show.
	 * `customer()` gives the customer picked for the sale, or null.
	 * `code()` gives the discount code on the sale, or null.
	 * `onChange(fn)` calls `fn` when the customer or the code changes and
	 * returns a function that stops it.
	 * `applyCode(code)` puts a discount code on the sale, like the cashier
	 * typing it: null when it was applied, else why not (the text to show).
	 * The cart must hold something first.
	 */
	"pos.cart": {
		customer: () => { id: number; name: string; phone: string | null } | null;
		code: () => string | null;
		onChange: (fn: () => void) => () => void;
		applyCode: (code: string) => Promise<string | null>;
	};
	/**
	 * Your own settings form, in the Configure dialog in place of the
	 * fields the app would draw from the manifest. The manifest's `fields`
	 * still say what is saved and checked. The dialog keeps its title,
	 * Cancel and Save, and gets wider.
	 * The script also runs while the extension is still off, and for it
	 * every file of your `assets/` is served to the shop's staff then too.
	 * Your routes are not: do not call `api.fetch` here.
	 * `values()` gives the settings as the form holds them now.
	 * `set(patch)` fills settings by field name; unknown names are ignored.
	 * `enabled()` / `setEnabled(on)` are the shop's switch: draw it
	 * yourself, the dialog no longer does.
	 * `errors()` gives the last save's refusals by field name, and
	 * `onErrors(fn)` calls `fn` when they change (it returns a function
	 * that stops it).
	 */
	"extension.config": {
		values: () => Config;
		set: (patch: Config) => void;
		enabled: () => boolean;
		setEnabled: (on: boolean) => void;
		errors: () => Record<string, string>;
		onErrors: (fn: () => void) => () => void;
	};
	/**
	 * The customer's screen (`/pos/display`, a second monitor): your element
	 * sits in the big column next to the cart. Show a QR code to pay, or
	 * advertisements while nothing is being sold.
	 * `sale()` gives the Sell screen's cart as it is now.
	 * `onChange(fn)` calls `fn` on every change and returns a function that
	 * stops it.
	 * `payment()` gives the payment method picked in a pay dialog and the
	 * cents asked for, or null while no pay dialog is open.
	 * `onPayment(fn)` calls `fn` when that changes and returns a function
	 * that stops it.
	 * Leave your element empty while you have nothing to show: the screen
	 * then shows the shop's logo and name.
	 * The same script is drawn next to every pay dialog while the picked
	 * method is the one your extension added. Fill the screen with
	 * `min-height: var(--display-height, calc(100dvh - 3rem))`.
	 * Read only: the screen can't change the cart.
	 * `place` says where this copy of the script runs: `"dialog"` next to
	 * a pay dialog (the cashier's side), `"screen"` on the customer's
	 * screen. Both may run at the same moment, so do work that must happen
	 * once (charge a card reader) only in the dialog.
	 * `approve(ref)` is for a payment method with `confirm: true` in the
	 * manifest's `payment_method`: every pay dialog keeps its confirm
	 * button off while that method is picked, until you call it. Call it
	 * when the money is taken. `ref` is a short text of your own (at most
	 * 200 characters, a charge id): the dialog then confirms by itself
	 * and sends it as `payment_ref`, which comes back on the events
	 * `order.created`, `order.updated` and `order.paid`. A change of the
	 * amount or the method takes the approval away. It does nothing on the
	 * customer's screen.
	 */
	"pos.display": {
		sale: () => DisplaySale;
		onChange: (fn: (sale: DisplaySale) => void) => () => void;
		payment: () => DisplayPayment | null;
		onPayment: (fn: (payment: DisplayPayment | null) => void) => () => void;
		place: "dialog" | "screen";
		approve: (ref: string) => void;
	};
};

/**
 * One line your script adds to a receipt (slot `order.receipt`).
 */
export type ReceiptLine = {
	text: string;
	/**
	 * Drawn at the right edge of the same line, like an amount.
	 */
	right?: string;
	bold?: boolean;
	center?: boolean;
};

/**
 * The payment method picked in a pay dialog (the Sell screen's checkout,
 * Record payment on an order, an extension's own with `api.paymentPicker`).
 */
export type DisplayPayment = {
	/**
	 * The method's name, as the shop calls it.
	 */
	method: string;
	/**
	 * The key of the extension that added the method (manifest
	 * `payment_method`), or null for the shop's own. Compare it with
	 * `api.key` to know the method is yours: the shop may rename it.
	 */
	extension: string | null;
	/**
	 * The cents the customer is asked for.
	 */
	amount: number;
};

/**
 * What the customer's screen shows. Money is integer cents.
 * `lines` is empty while nothing is being sold.
 */
export type DisplaySale = {
	lines: {
		name: string;
		/**
		 * The variant or the package's choices, when there are any.
		 */
		variant: string | null;
		qty: number;
		/**
		 * One unit.
		 */
		price: number;
		/**
		 * `price × qty`.
		 */
		total: number;
		image: string | null;
		/**
		 * The note the cashier typed on the line ("no onions"), when there is one.
		 */
		note: string | null;
	}[];
	/**
	 * How many units are in the cart (the sum of every `qty`).
	 */
	count: number;
	/**
	 * The name of the customer picked on the Sell screen, when there is one.
	 */
	customer: string | null;
	subtotal: number;
	discount: number;
	/**
	 * The tax worked out on `subtotal − discount`; already inside the
	 * prices when the shop's prices include it.
	 */
	tax: number;
	/**
	 * What the customer pays.
	 */
	total: number;
	/**
	 * The shop's currency, e.g. "THB".
	 */
	currency: string;
};

/**
 * The default export of a `store.page` script: it runs once on every page
 * of the shop's online store, after `window.Store` is ready.
 * `api.store` is `window.Store` (cart, money, checkout); the script may
 * replace `api.store.checkout` to send the cart somewhere of its own.
 * `api.fetch("/x")` calls the extension's public route `/x`.
 * @param api What the storefront hands the script.
 */
export type StoreScript = (api: StoreExtensionApi) => void | Promise<void>;

/**
 * The default export of a slot script (manifest `slots[].script`).
 * Build the UI inside `el`.
 * @param el The element the slot mounts in.
 * @param api The browser API, plus the slot's own `context`.
 * @returns Nothing, or a cleanup to run when the slot goes.
 */
export type SlotScript<S extends keyof SlotContexts = keyof SlotContexts> = (
	el: HTMLElement,
	api: Api & { context: SlotContexts[S] },
) => void | (() => void) | Promise<undefined | (() => void)>;

/**
 * Payment gateways.
 * A payment gateway is an extension whose manifest has a `payment` block,
 * `{ mode: "hosted" | "tokenize", … }`.
 * Its `fields` are the merchant's credentials: mark them `required`, and
 * `secret` ones are stored encrypted.
 * One gateway runs per shop — switching one on switches the other off.
 * The manual options, cash on delivery and bank transfer, are built into
 * the POS and are not extensions.
 * The entry module exports `payment`.
 * A failure the buyer should read ("Your card was declined") is an Error
 * whose `name` is "GatewayError".
 * Any other error is logged and the buyer sees a generic line.
 */

/**
 * One priced line of a checkout, in cents.
 */
export type PaymentLine = { name: string; price: number; qty: number };
/**
 * What a hosted checkout is asked to charge.
 */
export type CheckoutArgs = {
	/**
	 * The goods, then tax and delivery when they are charged.
	 */
	lines: PaymentLine[];
	/**
	 * A coupon discount to take off, in cents.
	 */
	discount?: { label: string; amount: number };
	/**
	 * The shop's currency.
	 */
	currency: string;
	/**
	 * Where the buyer comes back after paying.
	 * It has no query string, so append `?sid=<the id your getPayment()
	 * accepts>` yourself, or implement `returnId`.
	 */
	successUrl: string;
	/**
	 * Where the buyer comes back after giving up.
	 */
	cancelUrl: string;
	/**
	 * The order's public code, to show on the provider's page.
	 */
	reference: string;
	/**
	 * The buyer's email, when the checkout asked for one.
	 */
	email?: string;
	/**
	 * When the payment page must stop taking money (Unix seconds).
	 * Set when a discount code is held for this checkout.
	 * Pass it to the provider when it has such a setting.
	 */
	expires_at?: number;
};
/**
 * What the app tells a gateway when it looks a payment up.
 */
export type PaymentLookup = {
	/**
	 * False = do not take the money now.
	 * Only for a gateway that takes it during this call (PayPal captures
	 * an approved order here). The discount code of the checkout is no
	 * longer held, so its total no longer stands: answer `failed`.
	 * A gateway whose page already took the money ignores it.
	 */
	capture?: boolean;
};

/**
 * What the POS needs to know about a payment.
 * It is the same shape whatever the provider calls its own states.
 */
export type PaymentStatus = {
	/**
	 * True once the money is in.
	 */
	paid: boolean;
	/**
	 * Who paid, when the provider tells us.
	 */
	buyer: { email?: string | null; name?: string | null } | null;
	/**
	 * True when it will never succeed: declined, expired.
	 */
	failed?: boolean;
	/**
	 * Why it failed, when the provider says.
	 */
	reason?: string | null;
};
/**
 * The charge made from a browser-side nonce.
 * `id` is the provider's own id, to look the charge up later.
 * `url` is the 3-D Secure or provider page to send the buyer through.
 * It is null when the charge is already final.
 * `qr` is the code to scan when the method redirects nowhere, PromptPay
 * for example.
 */
export type Charge = { id: string; url: string | null; qr?: string };

/**
 * `mode: "hosted"` — the provider hosts the payment page.
 * The POS sends the buyer there and back to `/done`.
 */
export type HostedPayment = {
	/**
	 * Opens a payment page at the provider.
	 * @param config The merchant's credentials.
	 * @param args What to charge and where to send the buyer back.
	 * @returns The provider's checkout id and the page to send the buyer to.
	 */
	createCheckout: (
		config: Config,
		args: CheckoutArgs,
	) => Promise<{ id: string; url: string }>;
	/**
	 * Looks a payment up after the buyer returns.
	 * The reconcile sweep calls it too.
	 * @param config The merchant's credentials.
	 * @param id What `createCheckout` returned.
	 * @returns Whether it is paid, and who paid.
	 */
	getPayment: (
		config: Config,
		id: string,
		options?: PaymentLookup,
	) => Promise<PaymentStatus>;
	/**
	 * Reads the provider's own id when it brought the buyer back to
	 * `/done` without our `?sid=`.
	 * PayPal appends `?token=`, 2C2P posts a JWT.
	 * @param url The return URL.
	 * @param form The posted form, when there was one.
	 * @returns The id, or null when it isn't there.
	 */
	returnId?: (url: URL, form: FormData | null) => string | null | undefined;
};
/**
 * `mode: "tokenize"` — there is no hosted page.
 * The provider's own script collects the payment in the buyer's browser
 * (your `payment.script`) and hands back a nonce.
 * The POS posts that nonce to `/checkout/pay`, which calls `charge()`.
 * `payment.public_field` names the field the browser may see.
 */
export type TokenizePayment = {
	/**
	 * Turns stored cents into the provider's smallest currency unit.
	 * That is what the form shows and what the charge costs.
	 * @param cents The amount as the POS stores it.
	 * @param currency The shop's currency.
	 * @returns The amount in the provider's unit.
	 */
	amount: (cents: number, currency: string) => number;
	/**
	 * Lists the non-card methods the merchant's account has switched on.
	 * They are named as the browser form names them.
	 * @param config The merchant's credentials.
	 * @returns The method names. Never throws — [] on failure.
	 */
	methods?: (config: Config) => Promise<string[]>;
	/**
	 * Charges the nonce the browser script handed back.
	 * @param config The merchant's credentials.
	 * @param args The nonce, the amount and where to return the buyer.
	 * @returns The charge, with a page or a QR code when one is needed.
	 */
	charge: (
		config: Config,
		args: {
			token: string;
			amount: number;
			currency: string;
			returnUri: string;
			reference: string;
			description: string;
		},
	) => Promise<Charge>;
	/**
	 * Looks a charge up, later or from the reconcile sweep.
	 * @param config The merchant's credentials.
	 * @param id The charge id.
	 * @returns Whether it is paid, and who paid.
	 */
	getPayment: (config: Config, id: string) => Promise<PaymentStatus>;
};
/**
 * `export const payment` of a gateway's entry module.
 * It is hosted or tokenize, never both.
 */
export type Payment = HostedPayment | TokenizePayment;

/**
 * What the checkout hands a tokenize gateway's browser script.
 */
export type TokenizeInfo = {
	/**
	 * The credential the browser may see (`payment.public_field`).
	 */
	public_key: string;
	/**
	 * The amount in the provider's own unit.
	 */
	amount: number;
	/**
	 * The shop's currency.
	 */
	currency: string;
	/**
	 * Our own session reference for this checkout.
	 */
	ref: string;
	/**
	 * The other payment methods that are switched on.
	 */
	methods: string[];
};
/**
 * The default export of a tokenize gateway's checkout script.
 * It is the manifest's `payment.script`, loaded on the storefront when
 * the buyer taps Pay. Open the provider's form in it.
 * @param t The amount, the public key and the methods on.
 * @param api What to call back: `pay(nonce)` charges it server-side and
 * moves the buyer on (an error is shown for you), `cancel()` when the
 * buyer closes the form, `fail(message)` when the form can't open.
 */
export type PaymentScript = (
	t: TokenizeInfo,
	api: {
		store: { name: string };
		pay: (token: string) => Promise<void>;
		cancel: () => void;
		fail: (message: string) => void;
		/**
		 * Your dictionary in the buyer's language.
		 */
		t: Translate;
		/**
		 * That language.
		 */
		locale: string;
	},
) => void | Promise<void>;
