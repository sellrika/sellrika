import { Guard } from "@xcore/auth/Guard";
import { router } from "@xcore/http/Router";
import { HomeController } from "@controllers/Home.Controller";
import { StoreController } from "@controllers/Store.Controller";
import { StoreAccountController } from "@controllers/StoreAccount.Controller";
import { ExtensionController } from "@controllers/Extension.Controller";
import { developerHome } from "./api";
import { limit } from "./limits";

/**
 * The public pages, inside `maybeAuth`: no login is required.
 * "/" is the store on a store's host (not found when it is off),
 * else the way into the app: the POS or the sign-in
 * (an add-on's front page, when there is one).
 */
function pageRoutes() {
	/** On the docs host (DEVELOPER_DOMAIN) "/" is the API docs. */
	router.get("/", [HomeController, "home"], developerHome);
	router.get("/pages/:page", [StoreController, "page"]);
	router.get("/p/:product", [StoreController, "product"]);
	router.get("/checkout", [StoreController, "checkoutPage"]);
	router.get("/track", [StoreController, "trackPage"]);
	router.get("/account", [StoreAccountController, "accountPage"]);
	router.get("/account/orders/:reference", [StoreAccountController, "accountOrder"]);
	/**
	 * Marketing emails: "Complete your order" refills the cart,
	 * the unsubscribe page only asks (its button POSTs, below).
	 */
	router.get("/cart/:token", [StoreController, "restoreCart"]);
	router.get("/unsubscribe/:token", [StoreController, "unsubscribePage"]);
}

/**
 * The public online storefront. No login.
 * A store is found by its host only: the shop's own domain
 * (`shops.domain`), else its free address `<slug>.<STORE_DOMAIN>`.
 * On the main host these routes answer "not found":
 * no shop claims that hostname.
 * Only an extension's files and public routes keep the
 * `/store/:slug/ext/…` path, the same on every host.
 */
export function storefrontRoutes() {
	router.group(Guard.maybeAuth, pageRoutes);

	/**
	 * An extension's public routes and browser files
	 * (`publicRoutes` in its module, `assets/`).
	 * The shop comes from the slug. The same path on every host.
	 */
	router.any("/store/:slug/ext/:key/*", [ExtensionController, "storeRoute"], limit("storeExtension"));

	/**
	 * Customer accounts: the sign-in, the sign-out, and the profile
	 * and addresses the signed-in customer keeps.
	 * The sign-in is a Firebase token, verified on the server.
	 * It is limited so tokens can't be guessed or Firebase hammered.
	 * The controller checks the customer session cookie itself:
	 * these are not staff routes.
	 */
	router.post("/account/login", [StoreAccountController, "login"], limit("storeLogin"));
	router.post("/account/logout", [StoreAccountController, "logout"]);
	/**
	 * The account's own forms: plain HTML form posts,
	 * so they work without JavaScript.
	 * Profile, add an address, change one, remove one.
	 */
	router.post("/account", [StoreAccountController, "updateProfile"]);
	router.post("/account/addresses", [StoreAccountController, "addAddress"]);
	router.post("/account/addresses/:id", [StoreAccountController, "updateAddress"]);
	router.post("/account/addresses/:id/delete", [StoreAccountController, "removeAddress"]);

	/**
	 * Checkout.
	 * The guided address: State → City → postal code,
	 * from the downloaded GeoNames list.
	 * A discount code's quote ("Apply").
	 * The checkout itself.
	 * The browser-side charge of gateways with no hosted page (Omise).
	 */
	router.get("/address", [StoreController, "address"], limit("storeAddress"));
	router.post("/checkout/coupon", [StoreController, "coupon"], limit("storeCoupon"));
	router.group(limit("storeCheckout"), function checkoutRoutes() {
		router.post("/checkout", [StoreController, "checkout"]);
		/**
		 * A store with no payment option:
		 * the cart's button sends the order itself.
		 */
		router.post("/checkout/send", [StoreController, "send"]);
	});
	router.post("/checkout/pay", [StoreController, "pay"], limit("storePay"));

	/**
	 * Back from the gateway: the thank-you page creates the order once.
	 * 2C2P brings the buyer back with a POST (form field paymentResponse).
	 * That one is bounced onto the GET.
	 */
	router.get("/done", [StoreController, "done"], limit("storeDone"));
	router.post("/done", [StoreController, "doneReturn"]);

	/**
	 * "Where is my order": the order code + the buyer's email or phone.
	 * Limited so it can't be used to guess.
	 */
	router.post("/track", [StoreController, "track"], limit("storeTrack"));

	/**
	 * "Unsubscribe". Limited so tokens can't be tried in bulk.
	 * Also the one-click POST a mail app sends (List-Unsubscribe-Post).
	 */
	router.post("/unsubscribe/:token", [StoreController, "unsubscribe"], limit("storeUnsubscribe"));

	/**
	 * Search engines: on a store's host its own sitemap,
	 * on the main host the pages an add-on names (`Hooks.sitePaths`).
	 */
	router.get("/sitemap.xml", [StoreController, "sitemap"]);
	router.get("/robots.txt", [StoreController, "robots"]);
	/**
	 * The store's products as a product feed, for Google Merchant
	 * Center, Facebook / Instagram and TikTok. Store hosts only.
	 */
	router.get("/feed.xml", [StoreController, "feed"]);

	/**
	 * The store as Markdown for AI search tools (the llms.txt
	 * convention). Store hosts only.
	 */
	router.get("/llms.txt", [StoreController, "llms"]);

	/**
	 * The pages an extension brings to a store (manifest `storefront`),
	 * like a blog at `/blog`. The last route tried: every other one wins.
	 * On any other address it answers "not found", as before.
	 */
	router.get("/*", [ExtensionController, "storePage"], limit("storePage"));
}
