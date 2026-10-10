import type { Server } from "bun";
import { app } from "@config/app";
import { ORIGIN_FREE_PATHS } from "@constants/Security.Constant";

/**
 * Where the request came from.
 * Everything here reads headers the client controls.
 * So each function says when it trusts them.
 * `X-Forwarded-*` is only believed when TRUST_PROXY says a proxy
 * is really in front of us.
 * Without that, anyone can claim any IP or any hostname.
 */

type AnyServer = Server<unknown>;

/**
 * Where the request came from, and the addresses of our own hosts.
 * Everything here reads headers the client controls,
 * so each method says when it trusts them.
 */
export class Url {
	/** The running server, set by `useServer`. */
	static #server: AnyServer | null = null;

	/**
	 * Hand the running server to this module.
	 * `clientIp` needs it to read the real socket address.
	 * @param s The `Bun.serve` instance.
	 */
	static useServer(s: AnyServer) {
		Url.#server = s;
	}

	/**
	 * The client's IP, for rate limiting.
	 * Behind a trusted proxy it is the *last* `X-Forwarded-For` entry:
	 * the one our proxy added itself.
	 * The entries before it came from the client, who can write anything there.
	 * @param req The current request.
	 * @returns The last forwarded hop behind a trusted proxy,
	 *   else the socket address.
	 */
	static clientIp(req: Request): string {
		const hops = app.trustProxy
			? (req.headers.get("x-forwarded-for") ?? "").split(",")
			: [];
		return (
			hops.at(-1)?.trim() || Url.#server?.requestIP(req)?.address || "unknown"
		);
	}

	/**
	 * Hostname of the request, lowercased and without the port.
	 * A custom-domain storefront is matched by it.
	 * @param req The current request.
	 * @returns The hostname. The client controls it:
	 *   only ever use it for a *lookup* whose miss is safe.
	 */
	static hostOf(req: Request): string {
		return Url.#rawHost(req).toLowerCase().split(":")[0]!;
	}

	/**
	 * Absolute origin the visitor sees.
	 * Used for links handed to payment gateways and search engines.
	 * So `APP_URL` wins whenever it is set:
	 * a spoofed `Host` must never end up in a gateway's return URL.
	 * @param req The current request.
	 * @returns `https://host`: from APP_URL when set, else from the request.
	 */
	static originOf(req: Request): string {
		return app.url ? new URL(app.url).origin : Url.requestOrigin(req);
	}

	/**
	 * The origin as the request itself reports it, ignoring APP_URL.
	 * For a shop answering on its *own* domain, where the hostname
	 * was already matched against `shops.domain`.
	 * @param req The current request.
	 * @returns `https://host` built from the (proxy-aware) request headers.
	 */
	static requestOrigin(req: Request): string {
		const proto =
			Url.#forwarded(req, "x-forwarded-proto") ??
			new URL(req.url).protocol.replace(":", "");
		return `${proto}://${Url.#rawHost(req)}`;
	}

	/**
	 * The shop slug in a store host.
	 * Like `corner-coffee` in `corner-coffee.shop.sellrika.com`.
	 * @param host The request's hostname (`hostOf`).
	 * @returns The slug, or null when the host is not
	 *   one label under the store domain.
	 */
	static slugOfHost(host: string): string | null {
		const suffix = `.${app.domains.store}`;
		if (!host.endsWith(suffix)) return null;
		const slug = host.slice(0, -suffix.length);
		return slug && !slug.includes(".") ? slug : null;
	}

	/**
	 * The address of a shop's online store.
	 * It is its own domain, else `<slug>.<store domain>`.
	 * A real store domain is always `https` with no port:
	 * the proxy serves it on 443.
	 * Only a `localhost` store domain (dev) takes the scheme and port
	 * from APP_URL (or this server).
	 * @param shop The shop.
	 * @returns The origin, without a trailing slash.
	 *   Like `https://corner-coffee.shop.sellrika.com`.
	 */
	static storeOrigin(shop: { domain: string | null; slug: string | null }) {
		if (shop.domain) return `https://${shop.domain}`;
		if (app.domains.store !== "localhost")
			return `https://${shop.slug}.${app.domains.store}`;
		return Url.#devOrigin(`${shop.slug}.${app.domains.store}`);
	}

	/**
	 * The app's own main address, where people sign in.
	 * It is APP_URL. Without it (dev) it is this server on localhost.
	 * Use it for a link from another host of ours (the docs host) back to the app.
	 * @returns The origin, like `https://sellrika.com`, without a trailing slash.
	 */
	static appOrigin() {
		return new URL(app.url ?? `http://localhost:${app.port}`).origin;
	}

	/**
	 * The address a store page loads an uploaded picture from.
	 * It is always the app's own host (APP_URL), never the shop's domain.
	 * So the CDN cache in front of the app's host works for every store.
	 * @param path A stored picture: a `/uploads/…` path or an https link.
	 * @returns The full link on the app's host.
	 *   The path as it is when APP_URL is not set, or it is not an upload.
	 */
	static upload(path: string) {
		return app.url && path.startsWith("/uploads/")
			? Url.appOrigin() + path
			: path;
	}

	/**
	 * The address of the API docs host (`DEVELOPER_DOMAIN`).
	 * A real domain is always `https` with no port: the proxy serves it on 443.
	 * Only a `localhost` one (dev) takes the scheme and port of the app.
	 * @returns The origin, like `https://developer.sellrika.com`.
	 *   Null when no docs host is set.
	 */
	static developerOrigin() {
		const host = app.domains.developer;
		if (!host) return null;
		if (host !== "localhost" && !host.endsWith(".localhost"))
			return `https://${host}`;
		return Url.#devOrigin(host);
	}

	/**
	 * Is this request for the API docs host?
	 * @param req The current request.
	 * @returns True when a docs host is set and the request's hostname is it.
	 */
	static isDeveloperHost(req: Request) {
		return !!app.domains.developer && Url.hostOf(req) === app.domains.developer;
	}

	/**
	 * A redirect target taken from a header the client sent,
	 * reduced to a safe path on this site.
	 * It stops `Referer: https://evil.com` from turning any "go back"
	 * into an open redirect.
	 * @param value The raw header value (or null).
	 * @param fallback Where to go when it isn't usable.
	 * @returns A path beginning with a single "/".
	 */
	static samePath(value: string | null, fallback = "/"): string {
		if (!value) return fallback;
		try {
			const u = new URL(value, "http://internal");
			const path = u.pathname + u.search;
			return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
		} catch {
			return fallback;
		}
	}

	/**
	 * Is this a change sent by a page of another host?
	 * A store host is the same site as the staff host,
	 * so `sameSite=lax` alone does not keep its pages out.
	 * A sign-in needs no cookie at all, so every such request is checked,
	 * with or without a session.
	 * The paths of `ORIGIN_FREE_PATHS` are left out:
	 * they are meant to be called from somewhere else.
	 * @param req The current request.
	 * @returns True when the request changes something and its `Origin`
	 *   is not the host it was sent to.
	 */
	static foreign(req: Request): boolean {
		if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
		const path = new URL(req.url).pathname;
		if (ORIGIN_FREE_PATHS.some((p) => path === p || path.startsWith(`${p}/`)))
			return false;
		const site = req.headers.get("sec-fetch-site");
		if (site && site !== "same-origin" && site !== "none") return true;
		const origin = req.headers.get("origin");
		if (!origin) return false;
		try {
			return new URL(origin).hostname.toLowerCase() !== Url.hostOf(req);
		} catch {
			return true;
		}
	}

	/**
	 * A forwarded header, but only when a trusted proxy is in front of us.
	 * @param req The current request.
	 * @param name Header name.
	 * @returns The first value, or null when untrusted or absent.
	 */
	static #forwarded(req: Request, name: string) {
		if (!app.trustProxy) return null;
		const v = req.headers.get(name);
		return v ? v.split(",")[0]!.trim() || null : null;
	}

	/**
	 * The host the request names, with its port, as it was sent.
	 * @param req The current request.
	 * @returns The forwarded host behind a trusted proxy, else the `Host`
	 *   header, else the host of the request's URL.
	 */
	static #rawHost(req: Request) {
		return (
			Url.#forwarded(req, "x-forwarded-host") ??
			req.headers.get("host") ??
			new URL(req.url).host
		);
	}

	/**
	 * The address of a `localhost` host of ours (dev).
	 * It takes the scheme and the port of the app.
	 * @param host The host name, like `main-shop.localhost`.
	 * @returns The origin, without a trailing slash.
	 */
	static #devOrigin(host: string) {
		const base = new URL(app.url ?? `http://localhost:${app.port}`);
		return `${base.protocol}//${host}${base.port ? `:${base.port}` : ""}`;
	}
}
