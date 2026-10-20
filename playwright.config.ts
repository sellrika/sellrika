import { defineConfig } from "@playwright/test";
import { ADMIN } from "./e2e/helpers";
import {
	BASE_PORT,
	cloudEnv,
	outsideDir,
	portOf,
	SPECS,
	tmpOf,
} from "./e2e/tmp";

// E2E runs the real production server (built assets — `bun run test:e2e` builds first). Every spec file is its
// own project with its own server, port and throwaway SQLite DB + upload dir under $TMPDIR/pos-e2e-<port>
// (wiped before boot and in global-teardown; never data/pos.db or storage/), so files run in parallel while
// the tests inside a file stay serial.
const FIXTURES_PORT = BASE_PORT - 1; // one static fixture server for every spec's app server
/**
 * `E2E_MYSQL_URL` runs the same specs on MySQL instead of SQLite.
 * It names the server with no database: mysql://user:password@host:3306
 * Every spec's server then gets its own database `pos_e2e_<port>`, made new before boot.
 */
const MYSQL = process.env.E2E_MYSQL_URL;
/**
 * The database part of a spec server's command.
 * @param port The server's port.
 * @param tmp The server's throwaway folder.
 * @returns What runs before boot, and the server's database settings.
 */
function database(port: number, tmp: string) {
	if (!MYSQL) return { before: "", env: `DB_FILE=${tmp}/pos.db` };
	const name = `pos_e2e_${port}`;
	return {
		before: `bun e2e/fixtures/mysql-db.ts ${MYSQL} ${name} && `,
		env: `DB_CONNECTION=mysql DATABASE_URL=${MYSQL}/${name} DB_ALLOW_PUBLIC_KEY_RETRIEVAL=1`,
	};
}

export default defineConfig({
	testDir: "e2e",
	fullyParallel: false,
	// Files are independent (own server + DB each), so on CI run a couple side by side — Playwright's default there
	// is one worker, which runs the files back to back; more than two on a 4-vCPU runner just fights for CPU
	// (five at once timed out the first, cold test of a file). Locally the default (half the cores) is fine.
	workers: process.env.CI ? 2 : undefined,
	// A cold first page load on a loaded CI runner can take most of the default 30 s — give tests room there.
	timeout: process.env.CI ? 60_000 : 30_000,
	reporter: "list",
	globalTeardown: "./e2e/global-teardown.ts",
	use: {
		trace: "retain-on-failure",
		launchOptions: { slowMo: Number(process.env.SLOWMO ?? 0) },
	},
	projects: SPECS.map((spec) => ({
		name: spec,
		testMatch: `${spec}.spec.ts`,
		// an add-on's specs and our own extensions' sit in their own folders, which git ignores
		...(outsideDir(spec) && {
			testDir: outsideDir(spec)!,
			respectGitIgnore: false,
		}),
		use: { baseURL: `http://localhost:${portOf(spec)}` },
	})),
	webServer: [
		// the GeoNames + Firebase + Resend + exchange-rates stand-in (e2e/fixtures/serve.ts): the app servers download "postal codes", verify sign-in tokens and send email here, never at the real sites
		// reuseExistingServer: a stale one left by an interrupted run serves the very same files, so it must not block the next run
		{
			command: `PORT=${FIXTURES_PORT} bun e2e/fixtures/serve.ts`,
			url: `http://localhost:${FIXTURES_PORT}/health`,
			reuseExistingServer: true,
			timeout: 30_000,
		},
		...SPECS.map((spec) => {
			const port = portOf(spec),
				tmp = tmpOf(port);
			const db = database(port, tmp);
			return {
				// The admin is set here too (`ADMIN` in e2e/helpers.ts), so a local .env with another one never breaks a run.
				// APP_KEY is set here, not taken from .env: CI has no .env, and storing a credential (payment
				// gateway, email provider) fails without it. The DB is thrown away after the run, so a fixed key is fine.
				command: `rm -rf ${tmp} && mkdir -p ${tmp} && ${db.before}NODE_ENV=production PORT=${port} ADMIN_EMAIL=${ADMIN.email} ADMIN_PASSWORD=${ADMIN.password} DEVELOPER_DOMAIN=developer.localhost APP_KEY=e2e-throwaway-key ${db.env} UPLOAD_DIR=${tmp}/uploads EXTENSION_UPLOAD_DIR=${tmp}/extensions GEONAMES_ZIP_URL=http://localhost:${FIXTURES_PORT}/zip/ GEONAMES_DUMP_URL=http://localhost:${FIXTURES_PORT}/dump/ FIREBASE_API_KEY=AIzaE2ePlatformKey FIREBASE_AUTH_DOMAIN=e2e.firebaseapp.com FIREBASE_PROJECT_ID=e2e FIREBASE_APP_ID=1:1:web:e2e FIREBASE_MICROSOFT=1 FIREBASE_LOOKUP_URL=http://localhost:${FIXTURES_PORT}/firebase/lookup RESEND_API_URL=http://localhost:${FIXTURES_PORT}/resend/emails EXCHANGE_RATES_URL=http://localhost:${FIXTURES_PORT}/rates STRIPE_TERMINAL_API_URL=http://localhost:${FIXTURES_PORT}/terminal DOMAIN_CNAME=localhost ${cloudEnv(FIXTURES_PORT)} TRAEFIK_FILE=${tmp}/sellrika-shops.yaml bun app/server.ts`,
				url: `http://localhost:${port}/health`,
				reuseExistingServer: false,
				timeout: 60_000,
			};
		}),
	],
});
