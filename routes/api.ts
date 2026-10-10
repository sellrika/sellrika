import { ApiResponse } from "@xcore/api/ApiResponse";
import { type ApiDoc, apiDocs, type ApiMethod } from "@xcore/api/OpenApi";
import { ApiGuard } from "@xcore/auth/ApiGuard";
import { Guard } from "@xcore/auth/Guard";
import { RateLimit } from "@xcore/http/RateLimit";
import { type Middleware, router } from "@xcore/http/Router";
import { Url } from "@xcore/http/Url";
import { CategoryApiController } from "@controllers/api/Category.Api.Controller";
import { CouponApiController } from "@controllers/api/Coupon.Api.Controller";
import { DocsApiController } from "@controllers/api/Docs.Api.Controller";
import { GuideApiController } from "@controllers/api/Guide.Api.Controller";
import { MarketingApiController } from "@controllers/api/Marketing.Api.Controller";
import { McpApiController } from "@controllers/api/Mcp.Api.Controller";
import { OAuthController } from "@controllers/OAuth.Controller";
import { MeApiController } from "@controllers/api/Me.Api.Controller";
import { OrderApiController } from "@controllers/api/Order.Api.Controller";
import { PaymentMethodApiController } from "@controllers/api/PaymentMethod.Api.Controller";
import { ProductApiController } from "@controllers/api/Product.Api.Controller";
import { ReportApiController } from "@controllers/api/Report.Api.Controller";
import { SalesStaffApiController } from "@controllers/api/SalesStaff.Api.Controller";
import { StaffApiController } from "@controllers/api/Staff.Api.Controller";
import { StockApiController } from "@controllers/api/Stock.Api.Controller";
import { CategoryInput } from "@validators/Category.Validator";
import { CouponInput } from "@validators/Coupon.Validator";
import { AbandonedInput, CampaignInput, ScheduleInput } from "@validators/Marketing.Validator";
import { FulfillmentInput, OrderCreateInput, OrderItemsInput, PaymentInput, RefundInput, OrderDiscountInput, RemoveItemsInput, VoidInput } from "@validators/Order.Validator";
import { PaymentMethodInput } from "@validators/PaymentMethod.Validator";
import { ProductInput } from "@validators/Product.Validator";
import { SalesStaffInput } from "@validators/SalesStaff.Validator";
import { StockAdjustInput } from "@validators/Stock.Validator";
import { CouponQuery, GuideQuery, OrderQuery, PageQuery, PeriodQuery, ProductQuery, ReportQuery, StockMovementQuery, StockQuery } from "@validators/ApiQuery.Validator";
import type { ApiSchemaName } from "@validators/ApiResponse.Validator";
import { API_PREFIX, API_SPEC_PATH, MCP_PATH } from "@constants/Api.Constant";
import { Hooks } from "@xcore/hooks/Hooks";
import { OAUTH_AUTHORIZE_PATH, OAUTH_CORS_HEADERS, OAUTH_REGISTER_PATH, OAUTH_RESOURCE_PATH, OAUTH_SERVER_PATH, OAUTH_TOKEN_PATH } from "@constants/OAuth.Constant";
import { RATE_LIMITS } from "@constants/Security.Constant";
import { limit } from "./limits";

/** What a route points at: `[Controller, "method"]`. */
type Action = Parameters<typeof router.get>[1];

/**
 * Register one API route together with its docs.
 * The route is added under the API prefix, behind the role the docs name.
 * So a route can not exist without docs, and the docs can not name a wrong role.
 * @param method HTTP method.
 * @param path The path after the prefix, e.g. `/orders/:id`.
 * @param action `[Controller, "method"]`.
 * @param doc Tag, summary, role, query, body and answer.
 */
function api(
	method: ApiMethod,
	path: string,
	action: Action,
	doc: Omit<ApiDoc<ApiSchemaName>, "method" | "path" | "fn" | "run"> & {
		/**
		 * The route as a function for extensions (`products.create`).
		 * Every route has one.
		 */
		fn: string;
	},
) {
	// `run` = the same handler behind the same role check,
	// for the function extensions call
	apiDocs.push({
		method,
		path,
		...doc,
		run: ApiGuard.role(doc.role)(router.bare(action)),
	});
	router[method](`${API_PREFIX}${path}`, action, ApiGuard.role(doc.role));
	preflights.add(`${API_PREFIX}${path}`);
}

/**
 * Register a tool that only the MCP server has.
 * No API path answers it, and the API docs leave it out.
 * The tool is built from the docs like any other.
 * Its handler sits behind the same key and role checks.
 * @param method `get` = a tool that only reads.
 * @param path The tool's path, used only to build its call.
 *   Nothing is registered on it.
 * @param action `[Controller, "method"]`.
 * @param doc Tag, summary, role, query and body.
 *   There is no answer model: the tool has no docs page.
 */
function mcpTool(method: ApiMethod, path: string, action: Action, doc: Omit<ApiDoc<ApiSchemaName>, "method" | "path" | "answer" | "mcpOnly">) {
	const mcpOnly = router.handler(action, [ApiGuard.role(doc.role)]);
	// `run` = the handler behind its role check only: what the MCP server calls
	const run = ApiGuard.role(doc.role)(router.bare(action));
	apiDocs.push({ method, path, ...doc, answer: null, mcpOnly, run });
}

/**
 * Every API path, so each gets its preflight answer once.
 * A path has several methods.
 */
const preflights = new Set<string>();

/**
 * The CORS headers for a call from the docs host,
 * where "Test Request" runs in the reader's browser.
 * Only that one origin is named, never `*`.
 * The whole origin must match: scheme, host and port.
 * No cookie is allowed across: the API reads only the key header.
 * @param req The current request.
 * @returns The headers.
 *   Null when the call does not come from the docs host.
 */
function corsHeaders(req: Request) {
	const origin = Url.developerOrigin();
	if (!origin || req.headers.get("origin") !== origin) return null;
	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
		"Access-Control-Allow-Headers": "Authorization, Content-Type",
		"Access-Control-Expose-Headers": "Retry-After",
		"Access-Control-Max-Age": "600",
		Vary: "Origin",
	};
}

/**
 * Route middleware: let the docs host read the API's answers.
 * See `corsHeaders`.
 * @param next The handler to wrap.
 * @returns The wrapped handler.
 */
const cors: Middleware = function cors(next) {
	return async function withCors(req) {
		const res = await next(req);
		const headers = corsHeaders(req);
		if (headers) for (const [name, value] of Object.entries(headers)) res.headers.set(name, value);
		return res;
	};
};

/**
 * The answer to a CORS preflight (`OPTIONS`).
 * Yes for the docs host, a bare 204 for anyone else.
 * @param req The current request.
 * @returns 204, with the CORS headers when the docs host asks.
 */
function preflight(req: Request) {
	return new Response(null, { status: 204, headers: corsHeaders(req) ?? {} });
}

/**
 * Route middleware for `GET /`.
 * On the docs host (`DEVELOPER_DOMAIN`) the root is the API docs,
 * when an add-on brings that page (`Hooks.docsPage`).
 * Every other host goes on to its own front page or store.
 * @param next The handler to wrap.
 * @returns The wrapped handler.
 */
export const developerHome: Middleware = function developerHome(next) {
	return function home(req) {
		if (!Hooks.docsPage || !Url.isDeveloperHost(req)) return next(req);
		return Hooks.docsPage(req);
	};
};

/**
 * Wrong or missing keys are counted per IP. A good call costs nothing here:
 * good calls are counted per key, inside `ApiGuard.key`.
 */
const failedKeys = RateLimit.middleware("apiAuth", RATE_LIMITS.apiAuth, {
	render: function tooMany(_req, message) {
		return ApiResponse.error("rate_limited", message);
	},
	counts: function failed(res) {
		return res.status === 401;
	},
});

/**
 * Route middleware: let a page of any site read a public OAuth endpoint.
 * A browser-based MCP client calls them from its own origin.
 * They take no cookie and no key, so `*` gives nothing away.
 * @param next The handler to wrap.
 * @returns The wrapped handler.
 */
const openCors: Middleware = function openCors(next) {
	return async function withCors(req) {
		const res = await next(req);
		for (const [name, value] of Object.entries(OAUTH_CORS_HEADERS)) res.headers.set(name, value);
		return res;
	};
};

/**
 * The public OAuth endpoints: the two discovery files,
 * client registration and the code-for-key swap.
 * Inside `openCors` and the `oauth` limit.
 */
function oauthPublicRoutes() {
	router.get(OAUTH_RESOURCE_PATH, [OAuthController, "resource"]);
	/** A client looks for the file of `/mcp` under this longer path first. */
	router.get(`${OAUTH_RESOURCE_PATH}${MCP_PATH}`, [OAuthController, "resource"]);
	router.get(OAUTH_SERVER_PATH, [OAuthController, "server"]);
	router.post(OAUTH_REGISTER_PATH, [OAuthController, "register"]);
	router.post(OAUTH_TOKEN_PATH, [OAuthController, "token"]);
}

/**
 * OAuth 2.0 sign-in for the MCP server.
 * The consent page is for a signed-in admin.
 * A guest signs in first and comes back to it.
 */
function oauthRoutes() {
	router.group([openCors, limit("oauth")], oauthPublicRoutes);
	for (const path of [OAUTH_RESOURCE_PATH, `${OAUTH_RESOURCE_PATH}${MCP_PATH}`, OAUTH_SERVER_PATH, OAUTH_REGISTER_PATH, OAUTH_TOKEN_PATH]) router.options(path, [OAuthController, "preflight"]);
	router.get(OAUTH_AUTHORIZE_PATH, [OAuthController, "authorize"], Guard.comeBack, Guard.auth, Guard.admin);
	router.post(OAUTH_AUTHORIZE_PATH, [OAuthController, "approve"], Guard.auth, Guard.admin, limit("oauth"));
}

/**
 * Every API route that needs a key, area by area.
 * Inside `cors`, the failed-key limit, then `ApiGuard.key`.
 */
function keyedRoutes() {
	accountRoutes();
	productRoutes();
	categoryRoutes();
	stockRoutes();
	orderRoutes();
	couponRoutes();
	paymentMethodRoutes();
	staffRoutes();
	marketingRoutes();
	reportRoutes();
}

/**
 * The REST API: `/api/v1/*` with a key.
 * Its MCP server (`/mcp`, same key in `X-API-Key`, or an OAuth sign-in).
 * Its OpenAPI file (public).
 */
export function apiRoutes() {
	router.get(API_SPEC_PATH, [DocsApiController, "spec"]);

	router.group([cors, failedKeys, ApiGuard.key], keyedRoutes);
	/**
	 * Any other path under the prefix:
	 * a JSON 404, never the app's HTML one.
	 */
	router.any(`${API_PREFIX}/*`, ApiResponse.notFound, cors);
	for (const path of preflights) router.options(path, preflight);

	/**
	 * The same routes as MCP tools, with the same key
	 * (in `X-API-Key`, or as a Bearer key after an OAuth sign-in).
	 * One JSON-RPC endpoint.
	 */
	router.post(MCP_PATH, [McpApiController, "handle"], failedKeys, ApiGuard.mcpKey);
	/**
	 * MCP clients may try a GET (to open a stream)
	 * or a DELETE (to end a session).
	 * This server has neither.
	 */
	router.get(MCP_PATH, [McpApiController, "notAllowed"]);
	router.delete(MCP_PATH, [McpApiController, "notAllowed"]);
	oauthRoutes();
}

/** The key's own account, and the user guide tool. Each sits behind its own role. */
function accountRoutes() {
	api("get", "/me", [MeApiController, "show"], {
		fn: "account.me",
		tag: "Account",
		summary: "Who am I",
		description: "The key, its role right now, and the shop it works in. Use it to test a key.",
		role: "cashier",
		answer: "Me",
	});
	// the user guide is for assistants only: an MCP tool, not an API route
	mcpTool("get", "/guide", [GuideApiController, "show"], {
		tag: "Account",
		summary: "Read the user guide",
		description:
			"How to do things in the Sellrika app's own screens, step by step. Read it when the person asks how to do something, where to find a setting, or what a page is for. Without `topic` it answers with the overview and the list of topics. An extension the shop runs has its own topic in that list. The text is English: answer in the person's language.",
		role: "cashier",
		query: GuideQuery,
	});
}

/** The product routes. Each sits behind its own role. */
function productRoutes() {
	const tag = "Products";
	const example = {
		name: "Iced Latte",
		price: 450,
		purchase_price: 120,
		images: ["https://example.com/iced-latte.jpg"],
		barcode: "8850001112223",
		unit: "pcs",
		track_stock: true,
		stock: 24,
		low_stock_at: 5,
		category_ids: [3],
	};
	api("get", "/products", [ProductApiController, "index"], {
		fn: "products.list",
		tag,
		summary: "List products",
		role: "manager",
		query: ProductQuery,
		answer: { paged: "Product" },
	});
	api("post", "/products", [ProductApiController, "store"], {
		fn: "products.create",
		tag,
		summary: "Create a product",
		description: "Each entry of `images` is an `https://` link or the picture itself as base64 (a `data:image/…;base64,` URI or plain base64, 5 MB at most; the whole request 8 MB). Both are saved into our storage. `stock` is the opening count; later changes go through **Stock**.",
		role: "manager",
		body: ProductInput,
		example,
		answer: "Product",
		status: 201,
	});
	api("get", "/products/:id", [ProductApiController, "show"], {
		fn: "products.get",
		tag,
		summary: "Get a product",
		role: "manager",
		answer: "Product",
	});
	api("put", "/products/:id", [ProductApiController, "update"], {
		fn: "products.update",
		tag,
		summary: "Update a product",
		description: "Send the whole product. A variant sent with its `id` is kept; a variant left out is deleted. Leave `stock` out to keep the count. `images` works as in create: send the `/uploads/…` paths to keep, plus an `https://` link or base64 for a new picture; a picture left out is removed.",
		role: "manager",
		body: ProductInput,
		example: { ...example, stock: undefined, price: 480 },
		answer: "Product",
	});
	api("delete", "/products/:id", [ProductApiController, "destroy"], {
		fn: "products.delete",
		tag,
		summary: "Delete a product",
		description: "Refused while a package contains the product.",
		role: "manager",
		answer: "Deleted",
	});
}

/** The category routes. Each sits behind its own role. */
function categoryRoutes() {
	const tag = "Categories";
	const example = { name: "Drinks", color: "#f9c13b" };
	api("get", "/categories", [CategoryApiController, "index"], {
		fn: "categories.list",
		tag,
		summary: "List categories",
		role: "manager",
		answer: { list: "CategoryWithCount" },
	});
	api("post", "/categories", [CategoryApiController, "store"], {
		fn: "categories.create",
		tag,
		summary: "Create a category",
		description: "`image` is an `https://` link or the picture itself as base64 (a `data:image/…;base64,` URI or plain base64, 5 MB at most). Both are saved into our storage.",
		role: "manager",
		body: CategoryInput,
		example,
		answer: "Category",
		status: 201,
	});
	api("get", "/categories/:id", [CategoryApiController, "show"], {
		fn: "categories.get",
		tag,
		summary: "Get a category",
		role: "manager",
		answer: "CategoryWithCount",
	});
	api("put", "/categories/:id", [CategoryApiController, "update"], {
		fn: "categories.update",
		tag,
		summary: "Update a category",
		description: "Send the whole category. `image` works as in create: send the `/uploads/…` path to keep the picture, a link or base64 for a new one, null to remove it.",
		role: "manager",
		body: CategoryInput,
		example,
		answer: "Category",
	});
	api("delete", "/categories/:id", [CategoryApiController, "destroy"], {
		fn: "categories.delete",
		tag,
		summary: "Delete a category",
		description: "Its products stay, without the category.",
		role: "manager",
		answer: "Deleted",
	});
}

/** The stock routes. Each sits behind its own role. */
function stockRoutes() {
	const tag = "Stock";
	api("get", "/stock", [StockApiController, "index"], {
		fn: "stock.list",
		tag,
		summary: "List stock",
		description: "One row per tracked unit: a product, or one of its variants.",
		role: "manager",
		query: StockQuery,
		answer: { paged: "StockItem" },
	});
	api("get", "/stock/summary", [StockApiController, "summary"], {
		fn: "stock.summary",
		tag,
		summary: "Stock summary",
		role: "manager",
		answer: "StockSummary",
	});
	api("get", "/stock/movements", [StockApiController, "movements"], {
		fn: "stock.movements",
		tag,
		summary: "List movements of a unit",
		description: "The ledger of one product or variant, newest first.",
		role: "manager",
		query: StockMovementQuery,
		answer: { paged: "StockMovement" },
	});
	api("post", "/stock/adjustments", [StockApiController, "adjust"], {
		fn: "stock.adjust",
		destructive: true,
		tag,
		summary: "Adjust stock",
		description: "Send `delta` to add or remove units, or `set` to set the count. The count can not go below zero.",
		role: "manager",
		body: StockAdjustInput,
		example: { product_id: 12, delta: 10, reason: "received", note: "PO 118" },
		answer: "StockLevel",
		status: 201,
	});
}

/** The order routes. Each sits behind its own role. */
function orderRoutes() {
	const tag = "Orders";
	api("get", "/orders", [OrderApiController, "index"], {
		fn: "orders.list",
		tag,
		summary: "List orders",
		role: "cashier",
		query: OrderQuery,
		answer: { paged: "Order" },
	});
	api("post", "/orders", [OrderApiController, "store"], {
		fn: "orders.create",
		tag,
		summary: "Create an order",
		description:
			"Prices and costs are read from the products, never from the request. Stock is taken. A line may carry a `note`.\n\n**With `paid`** it rings up a sale like the POS does: `paid` is the cents handed over and `payment_method` is the **name** of one of the shop's payment methods.\n\n**Without `paid`** (or `paid: 0`) the order is written **unpaid**, to be paid later (a table's bill, a tab): `payment_method` is then only the name shown (default \"Pay later\"), `note` is a note on the order, and no discount or code is taken. Record the money with `POST /orders/{id}/payments`. Until it is paid in full, items can be added and removed.",
		role: "cashier",
		body: OrderCreateInput,
		example: {
			items: [{ product_id: 12, qty: 2, note: "no onions" }],
			payment_method: "Cash",
			paid: 1000,
		},
		answer: "Order",
		status: 201,
	});
	api("get", "/orders/:id", [OrderApiController, "show"], {
		fn: "orders.get",
		tag,
		summary: "Get an order",
		role: "cashier",
		answer: "OrderDetail",
	});
	api("post", "/orders/:id/payments", [OrderApiController, "payment"], {
		fn: "orders.pay",
		destructive: true,
		tag,
		summary: "Record a payment",
		description: "Money received for an unpaid or partly paid order (cash on delivery, bank transfer). Never more than what is due.",
		role: "cashier",
		body: PaymentInput,
		example: { amount: 900 },
		answer: "OrderPayment",
		status: 201,
	});
	api("post", "/orders/:id/items", [OrderApiController, "addItems"], {
		fn: "orders.add",
		tag,
		summary: "Add items to an order",
		description: "Only while the order is not paid in full, not refunded and not voided. The new lines are added (never merged into an old line), stock is taken, and the totals and the tax are worked out again. The change is kept in the order's `history`.",
		role: "cashier",
		body: OrderItemsInput,
		example: { items: [{ product_id: 12, qty: 1 }] },
		answer: "OrderDetail",
	});
	api("post", "/orders/:id/items/remove", [OrderApiController, "removeItems"], {
		fn: "orders.remove",
		tag,
		summary: "Remove items from an order",
		description:
			"Only while the order is not paid in full, not refunded and not voided. `qty` units leave the line `order_item_id`; the whole quantity deletes the line. Their stock goes back. The last item can not be removed (void the order), and the total can not go below what is already paid. The change is kept in the order's `history`.",
		role: "cashier",
		body: RemoveItemsInput,
		example: { items: [{ order_item_id: 31, qty: 1 }] },
		answer: "OrderDetail",
	});
	api("put", "/orders/:id/discount", [OrderApiController, "discount"], {
		fn: "orders.setDiscount",
		tag,
		summary: "Set the discount of an order",
		description:
			"Only while the order is not paid in full, not refunded and not voided, and only an order made at the till (not an online one). `discount_type` + `discount_value` (whole percent, or cents) like the till's discount; or `coupon` = a discount code, which replaces them. No type and no code takes the discount off. The tax and the total are worked out again; the total can not go below what is already paid.",
		role: "cashier",
		body: OrderDiscountInput,
		example: { discount_type: "percent", discount_value: 10 },
		answer: "OrderDetail",
	});
	api("put", "/orders/:id/fulfillment", [OrderApiController, "fulfillment"], {
		fn: "orders.setFulfillment",
		tag,
		summary: "Set the delivery step",
		description: "Online orders only. `fulfillment` is the key of one of the shop's delivery steps. Reaching `shipped` emails the buyer once.",
		role: "cashier",
		body: FulfillmentInput,
		example: { fulfillment: "shipped", tracking: "TH123456789" },
		answer: "OrderDetail",
	});
	api("post", "/orders/:id/refunds", [OrderApiController, "refund"], {
		fn: "orders.refund",
		destructive: true,
		tag,
		summary: "Refund an order",
		description: "Gives money back, part or all. `items` names the units that came back; with `restock` they go back into stock.",
		role: "admin",
		body: RefundInput,
		example: {
			amount: 450,
			reason: "Wrong size",
			restock: true,
			items: [{ order_item_id: 31, qty: 1 }],
		},
		answer: "Refund",
		status: 201,
	});
	api("post", "/orders/:id/void", [OrderApiController, "void"], {
		fn: "orders.void",
		destructive: true,
		tag,
		summary: "Void an order",
		description: "Undoes a sale that should not have happened: stock goes back and reports leave it out. Only an order with no refund.",
		role: "admin",
		body: VoidInput,
		example: { reason: "Rang up twice" },
		answer: "OrderDetail",
	});
}

/** The discount code routes. Each sits behind its own role. */
function couponRoutes() {
	const tag = "Coupons";
	const example = {
		code: "WELCOME10",
		description: "10% off your first order",
		type: "percent",
		value: 10,
		max_discount: 2000,
		ends_at: "2026-12-31",
		per_customer_limit: 1,
	};
	api("get", "/coupons", [CouponApiController, "index"], {
		fn: "coupons.list",
		tag,
		summary: "List coupons",
		role: "admin",
		query: CouponQuery,
		answer: { paged: "CouponWithStats" },
	});
	api("post", "/coupons", [CouponApiController, "store"], {
		fn: "coupons.create",
		tag,
		summary: "Create a coupon",
		description: "`value` is a percent (1–100) for `percent`, cents for `fixed`, and ignored for `free_delivery`.",
		role: "admin",
		body: CouponInput,
		example,
		answer: "Coupon",
		status: 201,
	});
	api("get", "/coupons/:id", [CouponApiController, "show"], {
		fn: "coupons.get",
		tag,
		summary: "Get a coupon",
		role: "admin",
		answer: "CouponWithStats",
	});
	api("get", "/coupons/:id/redemptions", [CouponApiController, "redemptions"], {
		fn: "coupons.redemptions",
		tag,
		summary: "List redemptions of a coupon",
		description: "The orders that used the code, newest first.",
		role: "admin",
		query: PageQuery,
		answer: { paged: "CouponRedemption" },
	});
	api("put", "/coupons/:id", [CouponApiController, "update"], {
		fn: "coupons.update",
		tag,
		summary: "Update a coupon",
		role: "admin",
		body: CouponInput,
		example,
		answer: "Coupon",
	});
	api("delete", "/coupons/:id", [CouponApiController, "destroy"], {
		fn: "coupons.delete",
		tag,
		summary: "Delete a coupon",
		description: "Orders that used it keep the code as text.",
		role: "admin",
		answer: "Deleted",
	});
}

/** The payment method routes. Each sits behind its own role. */
function paymentMethodRoutes() {
	const tag = "Payment methods";
	const example = { name: "Cash", icon: "Banknote", tendered: true };
	api("get", "/payment-methods", [PaymentMethodApiController, "index"], {
		fn: "paymentMethods.list",
		tag,
		summary: "List payment methods",
		role: "manager",
		answer: { list: "PaymentMethod" },
	});
	api("post", "/payment-methods", [PaymentMethodApiController, "store"], {
		fn: "paymentMethods.create",
		tag,
		summary: "Create a payment method",
		role: "manager",
		body: PaymentMethodInput,
		example,
		answer: "PaymentMethod",
		status: 201,
	});
	api("get", "/payment-methods/:id", [PaymentMethodApiController, "show"], {
		fn: "paymentMethods.get",
		tag,
		summary: "Get a payment method",
		role: "manager",
		answer: "PaymentMethod",
	});
	api("put", "/payment-methods/:id", [PaymentMethodApiController, "update"], {
		fn: "paymentMethods.update",
		tag,
		summary: "Update a payment method",
		role: "manager",
		body: PaymentMethodInput,
		example,
		answer: "PaymentMethod",
	});
	api("delete", "/payment-methods/:id", [PaymentMethodApiController, "destroy"], {
		fn: "paymentMethods.delete",
		tag,
		summary: "Delete a payment method",
		description: "A shop keeps at least one. Past orders keep the name.",
		role: "manager",
		answer: "Deleted",
	});
}

/** The staff (read only) and sales staff routes. Each sits behind its own role. */
function staffRoutes() {
	api("get", "/staff", [StaffApiController, "index"], {
		fn: "staff.list",
		tag: "Staff",
		summary: "List staff",
		description: "Everyone who can sign in to the account. Never a password.",
		role: "manager",
		answer: { list: "Staff" },
	});

	const tag = "Sales staff";
	const example = { name: "Mia", commission: 250 };
	api("get", "/sales-staff", [SalesStaffApiController, "index"], {
		fn: "salesStaff.list",
		tag,
		summary: "List sales staff",
		role: "manager",
		answer: { list: "SalesStaff" },
	});
	api("post", "/sales-staff", [SalesStaffApiController, "store"], {
		fn: "salesStaff.create",
		tag,
		summary: "Create a sales person",
		description: "`commission` is in hundredths of a percent: 250 = 2.5%.",
		role: "manager",
		body: SalesStaffInput,
		example,
		answer: "SalesStaff",
		status: 201,
	});
	api("get", "/sales-staff/:id", [SalesStaffApiController, "show"], {
		fn: "salesStaff.get",
		tag,
		summary: "Get a sales person",
		description: "What they sold in a period, the commission due, and their payment history.",
		role: "manager",
		query: PeriodQuery,
		answer: "SalesStaffDetail",
	});
	api("put", "/sales-staff/:id", [SalesStaffApiController, "update"], {
		fn: "salesStaff.update",
		tag,
		summary: "Update a sales person",
		role: "manager",
		body: SalesStaffInput,
		example,
		answer: "SalesStaff",
	});
	api("post", "/sales-staff/:id/pay", [SalesStaffApiController, "pay"], {
		fn: "salesStaff.pay",
		tag,
		summary: "Pay the commission",
		description: "Pays what is due now: one row in the history, and the count starts again. Refused when nothing is due.",
		role: "manager",
		answer: "SalesStaff",
	});
	api("delete", "/sales-staff/:id", [SalesStaffApiController, "destroy"], {
		fn: "salesStaff.delete",
		tag,
		summary: "Delete a sales person",
		description: "Their payment history goes too. Their sales stay.",
		role: "manager",
		answer: "Deleted",
	});
}

/** The marketing routes. Each sits behind its own role. */
function marketingRoutes() {
	const tag = "Marketing";
	const example = {
		subject: "New autumn menu",
		body: "<p>Come and try it.</p>",
		product_ids: [12],
		customer_ids: [4, 9],
	};
	api("get", "/marketing/abandoned-cart", [MarketingApiController, "abandoned"], {
		fn: "marketing.abandonedCart",
		tag,
		summary: "Get the abandoned-cart email",
		role: "manager",
		answer: "AbandonedCart",
	});
	api("put", "/marketing/abandoned-cart", [MarketingApiController, "saveAbandoned"], {
		fn: "marketing.setAbandonedCart",
		tag,
		summary: "Set the abandoned-cart email",
		description: "`hours` is the delay: 1, 4, 12 or 24.",
		role: "manager",
		body: AbandonedInput,
		example: { enabled: true, hours: 4 },
		answer: "AbandonedCart",
	});
	api("get", "/marketing/campaigns", [MarketingApiController, "index"], {
		fn: "marketing.campaigns",
		tag,
		summary: "List campaigns",
		role: "manager",
		query: PageQuery,
		answer: { paged: "Campaign" },
	});
	api("post", "/marketing/campaigns", [MarketingApiController, "store"], {
		fn: "marketing.createCampaign",
		tag,
		summary: "Create a campaign",
		description: "Saves a draft. Nothing is sent until it is scheduled.",
		role: "manager",
		body: CampaignInput,
		example,
		answer: "Campaign",
		status: 201,
	});
	api("get", "/marketing/campaigns/:id", [MarketingApiController, "show"], {
		fn: "marketing.campaign",
		tag,
		summary: "Get a campaign",
		role: "manager",
		answer: "Campaign",
	});
	api("put", "/marketing/campaigns/:id", [MarketingApiController, "update"], {
		fn: "marketing.updateCampaign",
		tag,
		summary: "Update a campaign",
		description: "Only a draft or a scheduled campaign.",
		role: "manager",
		body: CampaignInput,
		example,
		answer: "Campaign",
	});
	api("post", "/marketing/campaigns/:id/schedule", [MarketingApiController, "schedule"], {
		fn: "marketing.scheduleCampaign",
		destructive: true,
		tag,
		summary: "Schedule a campaign",
		description: "`date` and `time` are on the shop's clock. `now: true` sends at once and needs an **admin** key.",
		role: "manager",
		body: ScheduleInput,
		example: { date: "2026-10-15", time: "09:00" },
		answer: "Campaign",
	});
	api("post", "/marketing/campaigns/:id/cancel", [MarketingApiController, "cancel"], {
		fn: "marketing.cancelSchedule",
		tag,
		summary: "Cancel the schedule",
		description: "Back to a draft. Refused once it is sending or sent.",
		role: "manager",
		answer: "Campaign",
	});
	api("delete", "/marketing/campaigns/:id", [MarketingApiController, "destroy"], {
		fn: "marketing.deleteCampaign",
		tag,
		summary: "Delete a campaign",
		description: "Never while it is sending.",
		role: "manager",
		answer: "Deleted",
	});
}

/** The report routes. Each sits behind its own role. */
function reportRoutes() {
	api("get", "/reports", [ReportApiController, "index"], {
		fn: "reports.sales",
		tag: "Reports",
		summary: "Get the sales report",
		description: "Headline numbers, the same for the period before, a time series, and the top products, customers, methods, cashiers and categories.",
		role: "manager",
		query: ReportQuery,
		answer: "Report",
	});
}
