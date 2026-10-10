// first: an add-on changes the services before any route takes one
import "@cloud";
import { storefrontRoutes } from "./storefront";
import { accountRoutes } from "./account";
import { salesRoutes } from "./sales";
import { catalogRoutes } from "./catalog";
import { settingsRoutes } from "./settings";
import { fileRoutes } from "./files";
import { apiRoutes } from "./api";

/**
 * Every route of the app, one file per area.
 * It is the same split as app/services and the sidebar.
 * Each file wraps its own routes in the middleware they need:
 * `auth` (signed in), `admin` (admins only, after `auth`),
 * `maybeAuth` (public, staff get the "back to POS" bar),
 * a `limit("bucket")` from limits.ts.
 * So a route's access rules are read where the route is.
 * The router (app/xcore/http/Router.ts) is Laravel-style:
 * get/post/put/patch/delete/any/resource/redirect/group,
 * pointing at `[Controller, "method"]`.
 * The singleton comes from the DI container (app/xcore/di.ts)
 * with `this` bound.
 * Order matters only within a file: a static path before a `:param` twin,
 * e.g. /customers/search before /customers/:id.
 */

/**
 * Public: the online shops.
 * "/" and the rest sit at the root of each store's host:
 * its own domain or <slug>.<STORE_DOMAIN>.
 */
storefrontRoutes();
/**
 * /health, /login, /logout, /search,
 * /settings (own profile, password; email for admins).
 */
accountRoutes();
/** /pos, /orders, /customers, /coupons, /reports, /online-store. */
salesRoutes();
/** /products, /categories, /stock. */
catalogRoutes();
/** /shops, /users, /payment-methods. */
settingsRoutes();
/** /uploads (upload + serve), /build. */
fileRoutes();
/** /api/v1 (the REST API, with a key), /api/docs. */
apiRoutes();
