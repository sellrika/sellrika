import { Guard } from "@xcore/auth/Guard";
import { router } from "@xcore/http/Router";
import { ApiKeyController } from "@controllers/ApiKey.Controller";
import { AuthController } from "@controllers/Auth.Controller";
import { PaymentMethodController } from "@controllers/PaymentMethod.Controller";
import { PostalCodeController } from "@controllers/PostalCode.Controller";
import { OwnerController } from "@controllers/Owner.Controller";
import { ShopController } from "@controllers/Shop.Controller";
import { EmailController } from "@controllers/Email.Controller";
import { CurrencyController } from "@controllers/Currency.Controller";
import { ExtensionController } from "@controllers/Extension.Controller";
import { UserController } from "@controllers/User.Controller";
import { limit } from "./limits";

/** Every role. Inside `auth`. */
function staffRoutes() {
	/** The active shop lives on the session: both roles. */
	router.post("/shops/:id/switch", [ShopController, "switch"]);
	/**
	 * An extension's own pages, routes and browser files,
	 * for the active shop.
	 * Both roles: the extension decides who may do what.
	 */
	router.get("/extensions/:key/:page", [ExtensionController, "show"]);
	router.any("/ext/:key/*", [ExtensionController, "route"]);
}

/**
 * Managers and admins: the payment methods, and the staff.
 * A manager only adds and changes cashiers (UserService).
 * Inside `auth`, then `manager`.
 */
function managerRoutes() {
	router.resource("/users", UserController);
	/**
	 * The active shop's sales staff: people named on a sale,
	 * with a commission and no login (listed on /users).
	 * The first route: what they sold in a period, and what they were paid.
	 */
	router.get("/sales-staff/:id", [UserController, "showSales"]);
	router.post("/sales-staff", [UserController, "storeSales"]);
	router.put("/sales-staff/:id", [UserController, "updateSales"]);
	router.delete("/sales-staff/:id", [UserController, "destroySales"]);
	/** Commission paid: a history row, and the count starts again. */
	router.post("/sales-staff/:id/pay", [UserController, "paySales"]);
	router.resource("/payment-methods", PaymentMethodController);
}

/** Admins only. Inside `auth`, then `admin`. */
function adminRoutes() {
	router.resource("/shops", ShopController);
	/**
	 * The extensions the platform switched on, for the active shop:
	 * enable / configure.
	 */
	router.get("/extensions", [ExtensionController, "index"]);
	router.put("/extensions/:key", [ExtensionController, "update"]);
	/**
	 * The keys programs call the API with (/api/v1), for the active shop.
	 * A key is shown once.
	 */
	router.resource("/api-keys", ApiKeyController);
	/**
	 * The active shop's own outgoing email.
	 * None = it sends through the platform's.
	 */
	router.get("/shop-email", [EmailController, "shopIndex"]);
	router.put("/shop-email", [EmailController, "shopUpdate"]);
	router.post("/shop-email/test", [EmailController, "shopTest"], limit("mailTest"));
}

/**
 * The platform settings: only the platform admin (ADMIN_EMAIL).
 * The shop owners, the outgoing email, the extension code,
 * and the GeoNames cities & postal codes.
 * That last one is one list for the whole platform:
 * every shop's checkout reads it.
 * Inside `auth`, then `platform`.
 */
function platformRoutes() {
	/**
	 * The shop owners, their shops and how each shop is doing.
	 * Read-only, but for the campaign email limit.
	 */
	router.get("/owners", [OwnerController, "index"]);
	router.get("/owners/:id", [OwnerController, "show"]);
	/** The only thing an admin changes here. */
	router.put("/owners/:id/campaign-limit", [OwnerController, "campaignLimit"]);
	router.get("/owners/:id/shops/:shop", [OwnerController, "shop"]);
	router.get("/owners/:id/shops/:shop/products", [OwnerController, "products"]);
	/**
	 * The outgoing email for the whole platform:
	 * every provider's keys side by side.
	 */
	router.get("/email", [EmailController, "index"]);
	router.put("/email", [EmailController, "update"]);
	/** Mails an arbitrary address, like /shop-email/test. */
	router.post("/email/test", [EmailController, "test"], limit("mailTest"));
	/** The self sign-up switch, on the Shop owners page. */
	router.put("/owners/signup", [AuthController, "updateSignup"]);
	/**
	 * The automatic exchange rates every store's currency switcher uses:
	 * how often, and fetch now.
	 */
	router.get("/exchange-rates", [CurrencyController, "index"]);
	router.put("/exchange-rates", [CurrencyController, "update"]);
	router.post("/exchange-rates/refresh", [CurrencyController, "refresh"]);
	router.get("/postal-codes", [PostalCodeController, "index"]);
	/** Progress, polled while a download runs. */
	router.get("/postal-codes/status", [PostalCodeController, "status"]);
	/** Start / redo a download. */
	router.post("/postal-codes", [PostalCodeController, "download"]);
	/** Stop a download that looks stuck. */
	router.post("/postal-codes/cancel", [PostalCodeController, "cancel"]);
	/** Take a country off the list. */
	router.delete("/postal-codes/:code", [PostalCodeController, "remove"]);
	/**
	 * The extension code of the whole platform: built in + uploaded zips,
	 * each switched on for all shops or not.
	 */
	router.get("/admin/extensions", [ExtensionController, "globalIndex"]);
	/** "Available to": users to pick, searched. */
	router.get("/admin/extensions/users", [ExtensionController, "globalUserChoices"]);
	/** Who may use it ([] = every user). */
	router.put("/admin/extensions/:key/users", [ExtensionController, "globalUsers"]);
	/** Add a zip (file or https link). */
	router.post("/admin/extensions", [ExtensionController, "globalStore"]);
	router.put("/admin/extensions/:key", [ExtensionController, "globalUpdate"]);
	router.delete("/admin/extensions/:key", [ExtensionController, "globalDestroy"]);
}

/**
 * The Settings side of the sidebar (like `app/services/settings/`).
 * Shops, staff, payment methods, extensions.
 * The account's own settings are in account.ts.
 */
export function settingsRoutes() {
	router.group(Guard.auth, staffRoutes);
	router.group([Guard.auth, Guard.manager], managerRoutes);
	router.group([Guard.auth, Guard.admin], adminRoutes);
	router.group([Guard.auth, Guard.platform], platformRoutes);
}
