import { hostname } from "node:os"; // Bun has no equivalent

const env = process.env;

/** The app's settings, read from the environment. */
export const app = {
	/** The port the server listens on. */
	port: Number(env.PORT ?? 3000),
	/**
	 * True in production.
	 * Inlined at `bun build --compile` time.
	 * So compile with NODE_ENV=production.
	 */
	isProd: env.NODE_ENV === "production",
	/** The dev asset server. */
	viteUrl: env.VITE_URL ?? "http://localhost:5173",
	/**
	 * Where `vite build` writes the frontend (served at /build/*).
	 * Overridable so several test servers can build side by side.
	 */
	buildDir: env.BUILD_DIR ?? "public/build",
	/**
	 * The server bundle of the public pages.
	 * Written by `vite build --ssr`.
	 * Server code: kept out of public/.
	 */
	ssrBundle: env.SSR_BUNDLE ?? "build/ssr/ssr.js",
	/**
	 * The platform admin.
	 * The user with this email may change the platform settings
	 * (email, addresses, extensions).
	 * Every other admin is a plain shop owner.
	 * Compared in lower case.
	 */
	adminEmail: (env.ADMIN_EMAIL ?? "admin@sellrika.local").toLowerCase(),
	/**
	 * Google Analytics 4 id (`G-…`) of the main site:
	 * front page, pricing, sign-in.
	 * Empty = off. A shop's own store has its own id (`shops.ga_id`).
	 */
	gaId: env.GA_ID ?? "",
	/**
	 * The public base URL.
	 * Behind a proxy the request origin can be wrong.
	 * Falls back to the request origin.
	 */
	url: env.APP_URL || null,
	/**
	 * Only believe X-Forwarded-For / -Host / -Proto
	 * when a reverse proxy really is in front of us.
	 * Otherwise any client could claim any IP (rate limits)
	 * or any hostname (gateway return URLs).
	 */
	trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
	/**
	 * Where the GeoNames dumps are fetched from
	 * (/online-store › Delivery › Cities & postal codes).
	 * `<ISO>.zip` per country, `allCountries.zip` for everything (CC BY 4.0).
	 * Overridable so the e2e run serves fixtures instead
	 * (e2e/fixtures/serve.ts).
	 */
	geonames: {
		/** Postal codes. */
		zip: env.GEONAMES_ZIP_URL ?? "https://download.geonames.org/export/zip/",
		/**
		 * Place names.
		 * The fallback for a country with no postal-code file (Myanmar…).
		 */
		dump: env.GEONAMES_DUMP_URL ?? "https://download.geonames.org/export/dump/",
	},
	/**
	 * Where a customer's Firebase sign-in token is verified.
	 * Identity Toolkit `accounts:lookup`, called with the shop's web API key
	 * (app/gateways/firebase/Firebase.Api.ts).
	 * Overridable so the e2e run answers from its fixture server.
	 */
	firebaseLookupUrl:
		env.FIREBASE_LOOKUP_URL ??
		"https://identitytoolkit.googleapis.com/v1/accounts:lookup",
	/**
	 * The platform's own Firebase project.
	 * It runs "Continue with Google" on the staff sign-in page (/login).
	 * Every value is public: Firebase prints them in the browser.
	 * An empty `apiKey` = the Google button is off.
	 * A shop's online store has its own project (`shops.firebase_config`).
	 */
	firebase: {
		apiKey: env.FIREBASE_API_KEY ?? "",
		authDomain: env.FIREBASE_AUTH_DOMAIN ?? "",
		projectId: env.FIREBASE_PROJECT_ID ?? "",
		appId: env.FIREBASE_APP_ID ?? "",
		/**
		 * "1" = the project has the Microsoft provider switched on:
		 * show "Continue with Microsoft" too.
		 */
		microsoft: env.FIREBASE_MICROSOFT === "1",
	},
	/**
	 * Where the automatic exchange rates come from (/exchange-rates).
	 * An open.er-api.com-shaped JSON
	 * (`{ base_code, rates: { EUR: 0.92, … } }`, no key needed).
	 * Overridable so the e2e run answers from its fixture server.
	 */
	exchangeRatesUrl:
		env.EXCHANGE_RATES_URL ?? "https://open.er-api.com/v6/latest/USD",
	/**
	 * Custom store domains, routed and given SSL by Traefik
	 * (see `docker-compose.yml`).
	 */
	domains: {
		/**
		 * Every shop's free address is `<slug>.<store>`
		 * (`shop.sellrika.com` in production).
		 * The store pages are only served by host:
		 * this, or the shop's own domain.
		 * `localhost` works in dev:
		 * browsers send `<slug>.localhost` to this machine.
		 */
		store: (env.STORE_DOMAIN ?? "localhost").toLowerCase(),
		/**
		 * The host of the API docs (`developer.sellrika.com`).
		 * Its "/" is the docs page, and `/api/docs` goes there.
		 * Empty = no such host: the docs stay at `/api/docs` on the main host.
		 * In dev `developer.localhost` works:
		 * browsers send it to this machine.
		 */
		developer: (env.DEVELOPER_DOMAIN ?? "").toLowerCase(),
		/**
		 * The host merchants point their DNS at (`stores.sellrika.com`).
		 * Empty = nobody manages domains: the merchant sets up DNS and SSL alone.
		 */
		cname: env.DOMAIN_CNAME ?? "",
		/**
		 * The name of a Traefik certificate resolver that uses the DNS
		 * challenge (set up on the proxy).
		 * When set, every free store address `<slug>.<store>` is served by
		 * one router with one wildcard certificate `*.<store>`.
		 * Empty = one router and one certificate per open store.
		 */
		wildcardResolver: env.STORE_WILDCARD_RESOLVER ?? "",
		/**
		 * The Traefik dynamic-config file the app writes the live domains into.
		 * Its folder is one Traefik's file provider watches, mounted into the
		 * app.
		 */
		traefikFile: env.TRAEFIK_FILE ?? "/traefik/sellrika-shops.yaml",
		/**
		 * The Traefik service that reaches this app.
		 * Empty = the file brings its own, pointing at `traefikAppUrl`.
		 * Set it when the proxy already has a service for this app.
		 */
		traefikService: env.TRAEFIK_SERVICE ?? "",
		/**
		 * Where Traefik reaches this app, for the file's own service.
		 * The default is this container's own name on the Docker network.
		 */
		traefikAppUrl:
			env.TRAEFIK_APP_URL ?? `http://${hostname()}:${Number(env.PORT ?? 3000)}`,
		/**
		 * The names the proxy itself was started with.
		 * Many setups name the entrypoints `web` and `websecure`.
		 */
		traefik: {
			/** The entrypoint for port 80. */
			http: env.TRAEFIK_HTTP_ENTRYPOINT ?? "http",
			/** The entrypoint for port 443. */
			https: env.TRAEFIK_HTTPS_ENTRYPOINT ?? "https",
			/** The Let's Encrypt certificate resolver. */
			certResolver: env.TRAEFIK_CERT_RESOLVER ?? "letsencrypt",
		},
	},
};
