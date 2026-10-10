import { z } from "zod";
import { ROLES } from "@constants/User.Constant";
import { COUPON_TYPES } from "@constants/Coupon.Constant";
import { CAMPAIGN_STATUSES } from "@constants/Marketing.Constant";
import { PAYMENT_STATUSES } from "@constants/Order.Constant";
import { API_ERROR_STATUS, type ApiErrorType } from "@xcore/api/ApiResponse";

/**
 * What the API answers with, one schema per kind of record.
 * They are the "Models" of the API docs (`openapi.json`).
 * The tests parse real answers with them.
 * So the docs can not drift from the code.
 * Money is always whole cents. Times are UTC.
 */

/** A row id. */
const id = z.number().int().meta({ example: 12 });

/** A money amount, in whole cents. */
const cents = z.number().int().meta({ description: "Whole cents." });

/** A moment, as UTC text. */
const time = z
	.string()
	.meta({ description: "UTC time.", example: "2026-10-01 09:30:00" });

/** A day on the shop's clock, `YYYY-MM-DD`. */
const day = z.string().meta({
	description: "A day on the shop's clock.",
	example: "2026-10-01",
});

/** The one shape of every failed call. */
const ErrorBody = z
	.object({
		/** The one error of the call. */
		error: z.object({
			/** What went wrong, for programs: one of the API's error types. */
			type: z
				.enum(
					Object.keys(API_ERROR_STATUS) as [ApiErrorType, ...ApiErrorType[]],
				)
				.meta({ description: "What went wrong, for programs." }),
			/** The reason, for people. */
			message: z
				.string()
				.meta({ description: "The reason, for people.", example: "Not found" }),
			/**
			 * Only on `validation_error`:
			 * one message per refused input field.
			 */
			fields: z
				.record(z.string(), z.string())
				.optional()
				.meta({
					description:
						"Only on `validation_error`: one message per refused input field.",
					example: { name: "Name is required" },
				}),
		}),
	})
	.meta({ description: "Every failed call answers with this shape." });

/** The answer of a delete: the id that is gone. */
const Deleted = z.object({
	/** Always true. */
	deleted: z.literal(true),
	/** The id of the row that is gone. */
	id,
});

/** The key that is calling, and its shop. */
const Me = z.object({
	/** The API key that is calling. */
	key: z.object({
		/** The key's id. */
		id,
		/** The name the key was given. */
		name: z.string().meta({ example: "Warehouse sync" }),
		/** What this key may do right now: `admin`, `manager` or `cashier`. */
		role: z.enum(ROLES).meta({
			description: "What this key may do right now.",
		}),
	}),
	/** The one shop the key works in. */
	shop: z.object({
		/** The shop's id. */
		id,
		/** The shop's name. */
		name: z.string().meta({ example: "Main Shop" }),
		/** The currency the shop sells in: a 3-letter code. */
		currency: z.string().meta({ example: "USD" }),
		/** The shop's time zone, like `Asia/Bangkok`. */
		timezone: z.string().meta({ example: "Asia/Bangkok" }),
	}),
});

/** One category of the shop. */
const Category = z.object({
	/** The row's id. */
	id,
	/** The shop it belongs to. */
	shop_id: id,
	/** The category's name. */
	name: z.string().meta({ example: "Drinks" }),
	/** Its place in the shop's list. Lower comes first. */
	position: z.number().int(),
	/** The colour as `#rrggbb`. null = none. */
	color: z.string().nullable().meta({ example: "#f9c13b" }),
	/** Its picture, one of our uploads. null = none. */
	image: z.string().nullable().meta({
		example: "/uploads/1/categories/0199c1f2-7a3e-7000-8000-000000000000.webp",
	}),
});

/** A category with how many products it holds. */
const CategoryWithCount = Category.extend({
	/** How many products are in the category. */
	product_count: z.number().int().meta({ example: 8 }),
});

/** One payment method of the shop. */
const PaymentMethod = z.object({
	/** The row's id. */
	id,
	/** The shop it belongs to. */
	shop_id: id,
	/** The method's name. Orders keep this name. */
	name: z.string().meta({ example: "Cash" }),
	/** The icon on its button: a lucide icon name. */
	icon: z.string().meta({ example: "Banknote" }),
	/** The button's colour as `#rrggbb`. null = none. */
	color: z.string().nullable(),
	/**
	 * A picture shown on the customer's screen
	 * while this method is picked, such as a QR code to pay.
	 * null = none.
	 */
	image: z.string().nullable().meta({
		description:
			"A picture shown on the customer's screen while this method is picked, such as a QR code to pay.",
	}),
	/**
	 * The key of the extension that added this method.
	 * null = the shop's own.
	 */
	extension: z.string().nullable().meta({
		description:
			"The key of the extension that added this method, null for the shop's own.",
	}),
	/** Cash-like: the till asks for the amount handed over. */
	tendered: z.boolean().meta({
		description: "Cash-like: the till asks for the amount handed over.",
	}),
	/** False = hidden from checkout. */
	enabled: z.boolean(),
	/** Its place in the shop's list. Lower comes first. */
	position: z.number().int(),
});

/** One variant of a product. */
const ProductVariant = z.object({
	/** The row's id. */
	id,
	/** The product it is a variant of. */
	product_id: id,
	/** The variant's name. */
	name: z.string().meta({ example: "Large" }),
	/** The selling price, in whole cents. */
	price: cents,
	/** What the shop pays for one unit, in cents. null = not set. */
	purchase_price: cents.nullable(),
	/** Its place in the product form. Lower comes first. */
	position: z.number().int(),
	/**
	 * Its option values, like `{ "Color": "Red" }`.
	 * null = none.
	 */
	attributes: z.record(z.string(), z.string()).nullable(),
	/** The merchant's own code. null = none. */
	sku: z.string().nullable(),
	/** The barcode. null = none. */
	barcode: z.string().nullable(),
	/** The variant's own pictures. */
	images: z.array(z.string()),
	/** Units on hand. */
	stock: z.number().int(),
});

/** One slot of a package, with the variants it allows. */
const BundleItem = z.object({
	/** The slot's id. */
	id,
	/** The product the slot holds. */
	product_id: id,
	/** How many units of it one package holds. */
	qty: z.number().int(),
	/** The product's name. */
	name: z.string(),
	/** False = that product is switched off. */
	active: z.boolean(),
	/** What the buyer may pick for this slot. */
	options: z.array(
		z.object({
			/** The variant. null = the product has no variants. */
			variant_id: z.number().int().nullable(),
			/** The name of this choice. */
			name: z.string(),
			/** Its selling price, in whole cents. */
			price: cents,
			/** Units on hand. null = stock is not tracked. */
			stock: z.number().int().nullable(),
		}),
	),
});

/** One product, with its categories, variants and package slots. */
const Product = z.object({
	/** The row's id. */
	id,
	/** The shop it belongs to. */
	shop_id: id,
	/** The product's name. */
	name: z.string().meta({ example: "Iced Latte" }),
	/** Its name in the store address, unique per shop. */
	slug: z.string().meta({ example: "iced-latte" }),
	/** Rich text (HTML). */
	description: z.string().meta({ description: "Rich text (HTML)." }),
	/** The selling price, in whole cents. */
	price: cents.meta({ example: 450 }),
	/** What the shop pays for one unit, in cents. null = not set. */
	purchase_price: cents.nullable(),
	/** The "was" price, in cents. null = none. */
	original_price: cents.nullable(),
	/** The product's pictures. The first is the cover. */
	images: z.array(z.string()).meta({ example: ["/uploads/1/products/a.webp"] }),
	/** The merchant's own code. null = none. */
	sku: z.string().nullable(),
	/** The barcode. null = none. */
	barcode: z.string().nullable(),
	/** The sale unit, like `pcs`. null = none. */
	unit: z.string().nullable().meta({ example: "pcs" }),
	/** How much one unit holds: 50 for "50 g". null = none. */
	amount: z.number().nullable(),
	/** The "Additional data" rows: a title and a text each. */
	extra: z.array(
		z.object({
			/** The row's title. */
			title: z.string(),
			/** The row's text. */
			value: z.string(),
		}),
	),
	/** True = the stock of this product is counted. */
	track_stock: z.boolean(),
	/** Units on hand. */
	stock: z.number().int(),
	/** At this count or under, the product is low on stock. */
	low_stock_at: z.number().int(),
	/** True = pinned to the top of every product list. */
	featured: z.boolean(),
	/** True = the online store asks the buyer for a note. */
	custom_request: z.boolean(),
	/** The question over the buyer's box. "" = the default. */
	custom_request_label: z.string(),
	/** False = hidden from the POS and the online store. */
	active: z.boolean(),
	/** `item` = a normal product. `bundle` = a package. */
	kind: z.enum(["item", "bundle"]),
	/** The package's slots. [] for a normal product. */
	bundle_items: z.array(BundleItem),
	/** The categories the product is in. */
	categories: z.array(Category),
	/** The product's variants. [] = none. */
	variants: z.array(ProductVariant),
	/** When it was made (UTC). */
	created_at: time,
	/** When it was last changed (UTC). */
	updated_at: time,
});

/** One line of an order. */
const OrderItem = z.object({
	/** The row's id. */
	id,
	/** The order the line is on. */
	order_id: id,
	/** The product sold. It may be null. */
	product_id: z.number().int().nullable(),
	/** The variant sold. null = none. */
	variant_id: z.number().int().nullable(),
	/** The product's name when it was sold. */
	name: z.string().meta({ example: "Iced Latte" }),
	/** The unit price charged, in whole cents. */
	price: cents,
	/** The unit cost when it was sold, in cents. null = not known. */
	cost: cents.nullable(),
	/** Units sold. */
	qty: z.number().int(),
	/** Units that were refunded. */
	refunded_qty: z.number().int(),
	/** The line's own copy of the picture. null = none. */
	image: z.string().nullable(),
	/** The note on this line. "" = none. */
	note: z.string(),
});

/** One order with its lines. */
const Order = z.object({
	/** The row's id. */
	id,
	/** The public order code the buyer sees. */
	reference: z.string().nullable().meta({
		description: "The public order code the buyer sees.",
		example: "P8J4-MJSQ-4Z8T",
	}),
	/** The shop it belongs to. */
	shop_id: id,
	/** The user the order was made by. */
	user_id: id,
	/** The customer. null = none. */
	customer_id: z.number().int().nullable(),
	/** `completed`, `partially_refunded`, `refunded` or `voided`. */
	status: z.enum(["completed", "partially_refunded", "refunded", "voided"]),
	/** The goods before the discount, in cents. */
	subtotal: cents,
	/** `percent` or `fixed`. null = no discount. */
	discount_type: z.enum(["percent", "fixed"]).nullable(),
	/** A percent or cents, by `discount_type`. */
	discount_value: z.number().int(),
	/** What the discount took off, in cents. */
	discount: cents,
	/** The delivery charge, in cents. 0 at the POS. */
	delivery_fee: cents,
	/** The tax of the order, in cents. */
	tax: cents,
	/** The tax rate. Hundredths of a percent: 700 = 7%. */
	tax_rate: z.number().int().meta({
		description: "Hundredths of a percent: 700 = 7%.",
	}),
	/** The name of the tax line when the order was made. */
	tax_label: z.string(),
	/** True = the prices already held the tax. */
	tax_included: z.boolean(),
	/** What the order costs, in cents. */
	total: cents.meta({ example: 900 }),
	/** Cents received so far. */
	paid: cents,
	/** Cents given back as change. */
	change: cents,
	/** Cents refunded so far. */
	refunded: cents,
	/** The payment method's name when the order was made. */
	payment_method: z.string().meta({ example: "Cash" }),
	/** `unpaid`, `partial` or `paid`. */
	payment_status: z.enum(PAYMENT_STATUSES),
	/** The delivery step of an online order. "" = a POS sale. */
	fulfillment: z.string().meta({
		description: 'The delivery step of an online order. "" = a POS sale.',
	}),
	/** The parcel's tracking number. "" = none. */
	tracking: z.string(),
	/** The note on the order. "" = none. */
	note: z.string(),
	/** The discount code used. null = none. */
	coupon_code: z.string().nullable(),
	/** The sales person named on the order. null = none. */
	sales_staff_id: z.number().int().nullable(),
	/** When it was voided (UTC). null = not voided. */
	voided_at: time.nullable(),
	/** Why it was voided. null = not voided. */
	void_reason: z.string().nullable(),
	/** When it was made (UTC). */
	created_at: time,
	/** The order's lines. */
	items: z.array(OrderItem),
});

/** One refund of an order. */
const Refund = z.object({
	/** The row's id. */
	id,
	/** The order the money came from. */
	order_id: id,
	/** The staff user who made the refund. */
	user_id: id,
	/** Cents given back. */
	amount: cents,
	/** Why. "" = none given. */
	reason: z.string(),
	/** True = the returned units went back into stock. */
	restock: z.boolean(),
	/** When it was made (UTC). */
	created_at: time,
});

/**
 * The lines and the money of an order at one moment,
 * as the history keeps them.
 */
const OrderSnapshot = z.object({
	/** The lines at that moment: name, units and unit price. */
	items: z.array(
		z.object({
			/** The product's name. */
			name: z.string(),
			/** Units on the line. */
			qty: z.number().int(),
			/** The unit price, in whole cents. */
			price: cents,
		}),
	),
	/** The goods before the discount, in cents. */
	subtotal: cents,
	/** What the discount took off, in cents. */
	discount: cents,
	/** The tax, in cents. */
	tax: cents,
	/** What the order cost at that moment, in cents. */
	total: cents,
});

/** One order with its history and its refunds. */
const OrderDetail = Order.extend({
	/** Items added or removed after the order was made, oldest first. */
	history: z.array(
		z.object({
			/** The row's id. */
			id,
			/** `items_added` or `items_removed`. */
			type: z.enum(["items_added", "items_removed"]),
			/** When the change was made (UTC). */
			created_at: time,
			/** The name of who made the change. null = not known. */
			by: z.string().nullable(),
			/** What changed, and the order before and after. */
			data: z.object({
				/** The lines that were added or removed. */
				changed: OrderSnapshot.shape.items,
				/** The order before the change. */
				before: OrderSnapshot,
				/** The order after the change. */
				after: OrderSnapshot,
			}),
		}),
	),
	/** The order's refunds. */
	refunds: z.array(
		Refund.extend({
			/** The name of who made the refund. null = not known. */
			by: z.string().nullable(),
			/** The units that came back. */
			items: z.array(
				z.object({
					/** The order line. */
					order_item_id: id,
					/** Units that came back. */
					qty: z.number().int(),
					/** The line's product name. */
					name: z.string(),
				}),
			),
		}),
	),
});

/** What an order has received after a payment. */
const OrderPayment = z.object({
	/** Cents received so far. */
	paid: cents,
	/** `unpaid`, `partial` or `paid`. */
	payment_status: z.enum(PAYMENT_STATUSES),
});

/** One discount code. */
const Coupon = z.object({
	/** The row's id. */
	id,
	/** The shop it belongs to. */
	shop_id: id,
	/** The code the buyer types, in upper case. */
	code: z.string().meta({ example: "WELCOME10" }),
	/** The shop's note about the code. */
	description: z.string(),
	/** `percent`, `fixed` or `free_delivery`. */
	type: z.enum(COUPON_TYPES),
	/** A percent (1–100) or cents, by `type`. */
	value: z.number().int().meta({
		description: "A percent (1–100) or cents, by `type`.",
		example: 10,
	}),
	/** The goods must be worth at least this, in cents. */
	min_subtotal: cents,
	/** The most a percent code takes off, in cents. null = no cap. */
	max_discount: cents.nullable(),
	/** The first day it works. null = no first day. */
	starts_at: day.nullable(),
	/** The last day it works. null = no last day. */
	ends_at: day.nullable(),
	/** Uses allowed in all. null = no limit. */
	usage_limit: z.number().int().nullable(),
	/** Uses allowed per buyer. null = no limit. */
	per_customer_limit: z.number().int().nullable(),
	/** Only these products get the discount. [] = all. */
	product_ids: z.array(z.number().int()),
	/** Only these categories get the discount. [] = all. */
	category_ids: z.array(z.number().int()),
	/** Only these buyers may use it. [] = everyone. */
	emails: z.array(z.string()),
	/** False = switched off. */
	active: z.boolean(),
	/** When it was made (UTC). */
	created_at: time,
	/** When it was last changed (UTC). */
	updated_at: time,
});

/** A discount code with how often it was used. */
const CouponWithStats = Coupon.extend({
	/** How many times the code was used. */
	used_count: z.number().int(),
	/** Cents the code gave in all. */
	saved_total: cents,
});

/** One use of a discount code, with its order. */
const CouponRedemption = z.object({
	/** The row's id. */
	id,
	/** The code that was used. */
	coupon_id: id,
	/** The order it was used on. */
	order_id: id,
	/** The buyer's email. */
	email: z.string(),
	/** Cents the code took off. */
	amount: cents,
	/** When it was used (UTC). */
	created_at: time,
	/** The order's public code. null = none. */
	reference: z.string().nullable(),
	/** The order's total, in cents. null = not known. */
	order_total: cents.nullable(),
	/** The order's status. null = not known. */
	order_status: z.string().nullable(),
	/** The customer's name. null = not known. */
	customer_name: z.string().nullable(),
});

/** The stock count of one product or variant. */
const StockItem = z.object({
	/** The product. */
	product_id: id,
	/** The variant. null = the product itself. */
	variant_id: z.number().int().nullable(),
	/** The product's name. */
	name: z.string(),
	/** The variant's name. null = none. */
	variant_name: z.string().nullable(),
	/** A picture of it. null = none. */
	image: z.string().nullable(),
	/** The barcode. null = none. */
	barcode: z.string().nullable(),
	/** Units on hand. */
	stock: z.number().int().meta({ example: 24 }),
	/** At this count or under, it is low on stock. */
	low_stock_at: z.number().int(),
});

/** How many tracked units are low or out of stock. */
const StockSummary = z.object({
	/** How many units have their stock counted. */
	tracked: z.number().int(),
	/** How many of them are low on stock, out of stock included. */
	low: z.number().int(),
	/** How many of them are out of stock. */
	out: z.number().int(),
});

/** The stock count after one change. */
const StockLevel = z.object({
	/** The product. */
	product_id: id,
	/** The variant. null = the product itself. */
	variant_id: z.number().int().nullable(),
	/** The count after the change. */
	stock: z.number().int().meta({ description: "The count after the change." }),
});

/** One row of the stock ledger. */
const StockMovement = z.object({
	/** The row's id. */
	id,
	/** The product. */
	product_id: id,
	/** The variant. null = the product itself. */
	variant_id: z.number().int().nullable(),
	/** Why stock moved: `sale`, `refund`, `void` or `adjustment`. */
	type: z.enum(["sale", "refund", "void", "adjustment"]),
	/** Units moved. Signed: + in, − out. */
	qty: z.number().int().meta({ description: "Signed: + in, − out." }),
	/** The reason given. "" = none. */
	reason: z.string(),
	/** The order that moved it. null = none. */
	order_id: z.number().int().nullable(),
	/** The staff user who moved it. null = none. */
	user_id: z.number().int().nullable(),
	/** That user's name. null = not known. */
	by: z.string().nullable(),
	/** When it moved (UTC). */
	created_at: time,
});

/** One staff user of the account. */
const Staff = z.object({
	/** The row's id. */
	id,
	/** The account they belong to. null = they are the owner. */
	owner_id: z.number().int().nullable(),
	/** The person's name. */
	name: z.string(),
	/** The email they sign in with. */
	email: z.string(),
	/** `admin`, `manager` or `cashier`. */
	role: z.enum(ROLES),
	/** False = switched off, can't sign in. */
	active: z.boolean(),
	/** When it was made (UTC). */
	created_at: time,
});

/** One sales person, with what is still owed to them. */
const SalesStaff = z.object({
	/** The row's id. */
	id,
	/** The shop it belongs to. */
	shop_id: id,
	/** The sales person's name. */
	name: z.string().meta({ example: "Mia" }),
	/** The commission rate. Hundredths of a percent: 250 = 2.5%. */
	commission: z.number().int().meta({
		description: "Hundredths of a percent: 250 = 2.5%.",
		example: 250,
	}),
	/** False = switched off. */
	active: z.boolean(),
	/** When it was made (UTC). */
	created_at: time,
	/** How many sales name them. */
	orders: z.number().int(),
	/** When they were last paid (UTC). null = never. */
	last_paid_at: time.nullable(),
	/** How many sales since the last payment. */
	unpaid_orders: z.number().int(),
	/** The cents of those sales. Refunds are taken off. */
	unpaid_sales: cents,
	/** The commission not paid yet, in cents. */
	due: cents.meta({ description: "The commission not paid yet." }),
});

/** One commission payment to a sales person. */
const SalesCommission = z.object({
	/** The row's id. */
	id,
	/** The sales person who was paid. */
	sales_staff_id: id,
	/** Cents paid. */
	amount: cents,
	/** The cents of the sales it was paid for. */
	sales: cents,
	/** How many sales that was. */
	orders: z.number().int(),
	/** The rate used. Hundredths of a percent. */
	commission: z.number().int(),
	/** When it was paid (UTC). */
	created_at: time,
});

/** A sales person's numbers for a period and their payments. */
const SalesStaffDetail = z.object({
	/** The sales person. */
	person: SalesStaff,
	/** The period asked for: its preset, first and last day. */
	period: z.object({
		/** The period's preset. */
		preset: z.string(),
		/** Its first day. */
		from: day,
		/** Its last day. */
		to: day,
	}),
	/** The numbers of that period. */
	totals: z.object({
		/** How many sales in the period. */
		orders: z.number().int(),
		/** The cents of those sales. */
		sold: cents,
		/** The commission on them, in cents. */
		commission: cents,
	}),
	/** The payment history. */
	payments: z.array(SalesCommission),
});

/** One email campaign. */
const Campaign = z.object({
	/** The row's id. */
	id,
	/** The shop it belongs to. */
	shop_id: id,
	/** The email's subject line. */
	subject: z.string().meta({ example: "New autumn menu" }),
	/** The email's text. Rich text (HTML). */
	body: z.string().meta({ description: "Rich text (HTML)." }),
	/** The products shown as cards under the text. */
	product_ids: z.array(z.number().int()),
	/** The customers picked to get it. */
	customer_ids: z.array(z.number().int()),
	/** `draft`, `scheduled`, `sending` or `sent`. */
	status: z.enum(CAMPAIGN_STATUSES),
	/** When it goes out (UTC). null = a draft. */
	send_at: time.nullable(),
	/** How many emails went out. */
	sent: z.number().int(),
	/** How many emails failed. */
	failed: z.number().int(),
	/** When it was made (UTC). */
	created_at: time,
	/** When it was last changed (UTC). */
	updated_at: time,
});

/** The abandoned-cart email's switch and delay. */
const AbandonedCart = z.object({
	/** True = the shop sends the abandoned-cart email. */
	enabled: z.boolean(),
	/** Hours after the cart was left: 1, 4, 12 or 24. */
	hours: z.number().int().meta({ example: 4 }),
});

/** The totals of a report period. */
const ReportSummary = z.object({
	/** How many orders. Voided ones are left out. */
	orders: z.number().int(),
	/** Units sold. */
	items: z.number().int(),
	/** The goods before discounts, in cents. */
	gross: cents,
	/** What discounts took off, in cents. */
	discounts: cents,
	/** The order totals, in cents. */
	sales: cents,
	/** The tax collected, in cents. */
	tax: cents,
	/** Cents refunded. */
	refunds: cents,
	/** The cost of the goods sold, in cents. */
	cogs: cents,
	/** `sales` less `refunds`, in cents. */
	revenue: cents,
	/** `revenue` less `cogs` and `tax`, in cents. */
	profit: cents,
	/** Profit as a percent of revenue. null = no revenue. */
	margin: z.number().nullable().meta({ description: "Percent of revenue." }),
	/** The average order, in cents. */
	avg_order: cents,
});

/** The sales report of a period. */
const Report = z.object({
	/** The period the report covers. */
	query: z.object({
		/** The period's preset. */
		preset: z.string(),
		/** Its first day. */
		from: day,
		/** Its last day. */
		to: day,
		/** The bucket size of `series`. */
		by: z.enum(["day", "week", "month"]),
	}),
	/** The totals of the period. */
	summary: ReportSummary,
	/** The same numbers for the period just before, same length. */
	previous: ReportSummary.meta({
		description: "The same numbers for the period just before, same length.",
	}),
	/** The period cut into buckets, oldest first. */
	series: z.array(
		z.object({
			/** The bucket's day, week or month. */
			key: z.string(),
			/** Orders in the bucket. */
			orders: z.number().int(),
			/** Their totals, in cents. */
			sales: cents,
			/** Cents refunded in the bucket. */
			refunds: cents,
			/** The bucket's profit, in cents. */
			profit: cents,
		}),
	),
	/** The sales by hour of the day. */
	hours: z.array(
		z.object({
			/** The hour, 0 to 23, on the shop's clock. */
			hour: z.number().int(),
			/** Orders made in that hour. */
			orders: z.number().int(),
			/** Their totals, in cents. */
			sales: cents,
		}),
	),
	/** The best-selling products. */
	top_products: z.array(z.record(z.string(), z.unknown())),
	/** The top customers of the period. */
	top_customers: z.array(z.record(z.string(), z.unknown())),
	/** The sales by payment method. */
	by_method: z.array(z.record(z.string(), z.unknown())),
	/** The sales by staff user. */
	by_cashier: z.array(z.record(z.string(), z.unknown())),
	/** The sales by category. */
	by_category: z.array(z.record(z.string(), z.unknown())),
	/** The stock counts right now. */
	stock: StockSummary,
	/** Today on the shop's clock. */
	today: day,
});

/**
 * What the MCP tool `read_user_guide` answers.
 * Not an API model: the guide is not an API route.
 */
export const GuideAnswer = z.object({
	/** The topic that was read. */
	topic: z.string(),
	/** The topic's title. */
	title: z.string().meta({ example: "Orders" }),
	/** The guide, as Markdown. English only. */
	text: z.string().meta({
		description: "The guide, as Markdown. English only.",
	}),
	/**
	 * Every topic of the guide:
	 * the app's own, then one per extension the shop runs.
	 */
	topics: z
		.array(
			z.object({
				/** The topic's key. */
				topic: z.string(),
				/** The topic's title. */
				title: z.string(),
			}),
		)
		.meta({
			description:
				"Every topic of the guide: the app's own, then one per extension the shop runs.",
		}),
});

/** Every named answer of the API, by the name the docs show. */
export const ApiSchemas = {
	Error: ErrorBody,
	Deleted,
	Me,
	Category,
	CategoryWithCount,
	PaymentMethod,
	Product,
	Order,
	OrderDetail,
	OrderPayment,
	Refund,
	Coupon,
	CouponWithStats,
	CouponRedemption,
	StockItem,
	StockSummary,
	StockLevel,
	StockMovement,
	Staff,
	SalesStaff,
	SalesStaffDetail,
	SalesCommission,
	Campaign,
	AbandonedCart,
	Report,
} as const;

/** The name of one answer, as the docs show it. */
export type ApiSchemaName = keyof typeof ApiSchemas;
