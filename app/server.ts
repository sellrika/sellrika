import { router } from "@xcore/http/Router";
import { Url } from "@xcore/http/Url";
import { I18n } from "@xcore/i18n/I18n";
import { Storage } from "@xcore/storage/Storage";
import { translate } from "@i18n";
import { app } from "@config/app";
import { MAX_REQUEST_BODY_BYTES } from "@constants/Security.Constant";
import { migrate } from "@database/migrate";
import { seed } from "@database/seed";
import { Container } from "@xcore/di";
import { JobRegistry } from "@jobs/Job.Registry";
import { SessionRepository } from "@repositories/Session.Repository";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import "@routes/web";

// ponytail: migrate on boot.
// Split into a `migrate` subcommand if multi-instance deploys race.
await migrate();
await seed();
await Storage.ensure();
/**
 * Zips that shops uploaded before extensions were one catalog
 * for the platform are moved into it once. After that it is a no-op.
 */
await Container.get(ExtensionService).adoptShopUploads();
// expired sessions can't authenticate, so they are not kept around
await Container.get(SessionRepository).purgeExpired();

const server = Bun.serve({
	port: app.port,
	/**
	 * A JSON body far larger than the 5 MB image cap
	 * is only ever an attempt to make us chew on it.
	 */
	maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
	routes: router.routes,
	fetch: (req) =>
		new Response(translate(I18n.localeOf(req), "server.not_found"), {
			status: 404,
		}),
});
// rate limiting needs the real socket address
Url.useServer(server);

JobRegistry.start();

/**
 * Without APP_URL, links we hand a payment gateway are built
 * from the request's own Host header, which a client controls.
 * Set APP_URL (and TRUST_PROXY=1 when a reverse proxy terminates TLS).
 */
if (app.isProd && !app.url)
	console.warn(
		"[security] APP_URL is not set — payment return URLs and the sitemap will trust the request's Host header",
	);
/**
 * Every store without its own domain is at <slug>.<STORE_DOMAIN>.
 * Left at localhost, nobody outside can open them.
 */
if (app.isProd && app.domains.store === "localhost")
	console.warn(
		"[stores] STORE_DOMAIN is not set — every store is at <slug>.localhost; set it to the wildcard domain (shop.sellrika.com)",
	);
/**
 * Saved secrets (payment keys, mail passwords, extension keys)
 * are encrypted with APP_KEY.
 * A different key on the next start makes them unreadable.
 */
if (app.isProd && !process.env.APP_KEY)
	console.warn(
		"[security] APP_KEY is not set — payment, email and extension settings can't be saved; set one long random value and keep it the same on every start",
	);

console.log(
	`→ open http://localhost:${server.port}  (Vite on ${app.viteUrl} only serves assets)`,
);
