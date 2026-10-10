/**
 * Where a shop's custom domain stands (`shops.domain_status`).
 *   '' = no domain
 *   pending = waiting for the DNS to point at us
 *   live = in the Traefik file, with an SSL certificate
 */
export type DomainStatus = "" | "pending" | "live";

/**
 * How often every custom domain's DNS is checked: every 5 minutes.
 * A domain that points here goes into the Traefik file.
 * One that moved away comes out.
 */
export const DOMAIN_CRON = "*/5 * * * *";

/**
 * The names in the Traefik file we write.
 * The file brings its own middlewares, and its own service when none is
 * named, so it needs nothing from the proxy's other files.
 * The names of the proxy itself (entrypoints, certificate resolver) are
 * settings: `config/app.ts` › `domains.traefik`.
 */
export const TRAEFIK = {
	/** Everything we write starts with this, so it never clashes. */
	prefix: "sellrika-shop-",
	/** Our middleware that sends http to https. */
	redirect: "sellrika-shop-redirect",
	/** Our middleware that compresses answers. */
	gzip: "sellrika-shop-gzip",
	/** Our own service for the app, when no other one is named. */
	service: "sellrika-shop-app",
} as const;

/**
 * Our own domain.
 * A custom domain that contains it is refused.
 * So no shop can pose as us (`sellrika.com`, `x.sellrika.com`).
 */
export const PLATFORM_DOMAIN = "sellrika.com";

/**
 * The TXT record that proves a shop owns its custom domain:
 * `_sellrika.<domain>`.
 * Its value is `domainToken(shop id, domain)`.
 * Without it the domain never goes live.
 * So a shop can't take a domain that someone else pointed at us.
 */
export const DOMAIN_TXT_LABEL = "_sellrika";

/**
 * How many custom domains the domain job looks up side by side.
 */
export const DOMAIN_CHECK_BATCH = 5;
