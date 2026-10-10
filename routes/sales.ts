import { Guard } from "@xcore/auth/Guard";
import { router } from "@xcore/http/Router";
import { CouponController } from "@controllers/Coupon.Controller";
import { CustomerController } from "@controllers/Customer.Controller";
import { MarketingController } from "@controllers/Marketing.Controller";
import { OrderController } from "@controllers/Order.Controller";
import { PosController } from "@controllers/Pos.Controller";
import { PostalCodeController } from "@controllers/PostalCode.Controller";
import { ReportController } from "@controllers/Report.Controller";
import { StoreSettingsController } from "@controllers/StoreSettings.Controller";
import { limit } from "./limits";

/** Every role: selling, order handling, customers. Inside `auth`. */
function staffRoutes() {
	router.get("/pos", [PosController, "index"]);
	/** The customer's screen, for a second monitor. */
	router.get("/pos/display", [PosController, "display"]);
	/** The grid's next page / search / category / ids (JSON). */
	router.get("/pos/products", [PosController, "products"]);
	router.post("/pos/checkout", [PosController, "checkout"]);
	/** The cart saved as an unpaid order ("Pay later"). */
	router.post("/pos/open", [PosController, "open"]);
	/** What a discount code takes off the cart. */
	router.post("/pos/coupon", [PosController, "coupon"]);

	router.get("/orders", [OrderController, "index"]);
	router.get("/orders/:id", [OrderController, "show"]);
	/** Packing and shipping is till work, not money: both roles. */
	router.put("/orders/:id/fulfillment", [OrderController, "fulfillment"]);
	/** Cash on delivery collected, or a transfer seen: both roles. */
	router.post("/orders/:id/payments", [OrderController, "payment"]);
	/**
	 * An order that is not paid yet may still change:
	 * more lines (from the Sell screen), fewer lines.
	 */
	router.post("/orders/:id/items", [OrderController, "addItems"]);
	router.post("/orders/:id/items/remove", [OrderController, "removeItems"]);

	/** Before the resource, so /customers/:id doesn't catch it. */
	router.get("/customers/search", [CustomerController, "search"], limit("search"));
	router.resource("/customers", CustomerController);
	/** A customer's addresses: several, added and changed on their page. */
	router.post("/customers/:id/addresses", [CustomerController, "saveAddress"]);
	router.put("/customers/:id/addresses/:address", [CustomerController, "saveAddress"]);
	router.delete("/customers/:id/addresses/:address", [CustomerController, "destroyAddress"]);
}

/**
 * Managers and admins: marketing and reports.
 * Inside `auth`, then `manager`.
 */
function managerRoutes() {
	/**
	 * /marketing: email campaigns and the abandoned-cart email.
	 * Every change is a POST / PUT / DELETE; the sweep does the sending.
	 */
	router.get("/marketing", [MarketingController, "index"]);
	router.put("/marketing/abandoned", [MarketingController, "abandoned"]);
	router.get("/marketing/customers", [MarketingController, "customers"]);
	router.get("/marketing/campaigns/create", [MarketingController, "create"]);
	router.post("/marketing/campaigns", [MarketingController, "store"]);
	router.get("/marketing/campaigns/:id", [MarketingController, "show"]);
	router.put("/marketing/campaigns/:id", [MarketingController, "update"]);
	router.delete("/marketing/campaigns/:id", [MarketingController, "destroy"]);
	router.post("/marketing/campaigns/:id/schedule", [MarketingController, "schedule"]);
	router.post("/marketing/campaigns/:id/cancel", [MarketingController, "cancel"]);
	router.post("/marketing/campaigns/:id/test", [MarketingController, "test"], limit("marketingTest"));
	router.get("/reports", [ReportController, "index"]);
	/** The daily report: when it goes out and to which chat channels. */
	router.put("/reports/schedule", [ReportController, "schedule"]);
}

/**
 * Admin only: money back, discount codes, the online store.
 * Inside `auth`, then `admin`.
 */
function adminRoutes() {
	router.post("/orders/:id/refund", [OrderController, "refund"]);
	router.post("/orders/:id/void", [OrderController, "void"]);
	/** The shop's own delivery steps. */
	router.put("/orders/steps", [OrderController, "steps"]);
	/** Discount codes (online checkout + the till). */
	router.resource("/coupons", CouponController);

	/**
	 * /online-store: the storefront's settings.
	 * They are split in sections (?section=): general / template /
	 * banner & contact / delivery / payments / alerts / pages.
	 */
	router.get("/online-store", [StoreSettingsController, "settings"]);
	router.put("/online-store", [StoreSettingsController, "update"]);
	/** The custom domain's DNS, checked now. */
	router.post("/online-store/domain/check", [StoreSettingsController, "checkDomain"]);
	/** Shipping zones, pick-up, address lists. */
	router.put("/online-store/delivery", [StoreSettingsController, "delivery"]);
	/** The languages the store offers. */
	router.put("/online-store/languages", [StoreSettingsController, "languages"]);
	/** One built-in theme's own colours and font. */
	router.put("/online-store/theme", [StoreSettingsController, "theme"]);
	/** The extra currencies prices are shown in. */
	router.put("/online-store/currencies", [StoreSettingsController, "currencies"]);
	/** City / state suggestions for a zone's chips. */
	router.get("/online-store/delivery/places", [PostalCodeController, "places"]);
	router.get("/online-store/pages/create", [StoreSettingsController, "createPage"]);
	router.get("/online-store/pages/:id/edit", [StoreSettingsController, "editPage"]);
	router.post("/online-store/pages", [StoreSettingsController, "storePage"]);
	router.put("/online-store/pages/:id", [StoreSettingsController, "updatePage"]);
	router.delete("/online-store/pages/:id", [StoreSettingsController, "destroyPage"]);
}

/**
 * The Sales side of the sidebar (like `app/services/sales/`).
 * POS, orders, customers, coupons, reports,
 * and the online store's admin.
 */
export function salesRoutes() {
	router.group(Guard.auth, staffRoutes);
	router.group([Guard.auth, Guard.manager], managerRoutes);
	router.group([Guard.auth, Guard.admin], adminRoutes);
}
