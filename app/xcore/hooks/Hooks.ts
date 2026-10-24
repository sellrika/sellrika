import { DOCS_URL } from "@constants/Api.Constant";
import type { User } from "@models/User";
import type { BunRequest, SQL } from "bun";

/**
 * What every app page shows about the account's plan.
 * `banner` = a line over the page, null = none.
 * `href` = the plan's own page, null when this user may not open it.
 * `cta` = the words of the link next to the banner.
 * `menu` = the words of the link in the user menu.
 */
export type PlanNotice = {
	banner: string | null;
	href: string | null;
	cta: string;
	menu: string;
};

/** What the sign-up form shows on top of its own fields. */
export type SignupInfo = {
	/** A line over the form, null = none. */
	note: string | null;
	/** Ask the person to agree to `/terms` and `/privacy`. */
	terms: boolean;
};

/**
 * The few places where an add-on may change the app.
 * The source-available app leaves every one at its default.
 * The hosted edition sets them in `cloud/index.ts` (alias `@cloud`).
 * Set them before the server starts, never during a request.
 */
export class Hooks {
	/**
	 * The page at `/` of the app's own host.
	 * null = there is no front page: `/` goes to the sign-in.
	 */
	static frontPage: ((req: Request) => Promise<Response>) | null = null;

	/**
	 * Answers a request before the app's own route.
	 * It runs on every request, so it must be cheap:
	 * look at the host or the path first, and return null fast.
	 * Its answer still gets the security headers, gzip and the
	 * request's language. A signed-in change from another host is
	 * refused before it runs.
	 * null (the hook) = nothing runs.
	 * null (its answer) = the app's own route answers.
	 */
	static beforeRoute: ((req: BunRequest) => Promise<Response | null>) | null =
		null;

	/**
	 * The paths of the app's own public pages, for its sitemap.
	 * Empty = the main host's sitemap lists nothing.
	 */
	static sitePaths: string[] = [];

	/**
	 * Hosts no search engine may crawl: a demo store,
	 * or a site of an add-on that is not open yet.
	 * Their `/robots.txt` closes every path.
	 */
	static closedHosts: string[] = [];

	/**
	 * The page at `/` of the docs host (`DEVELOPER_DOMAIN`).
	 * null = the docs host has no page of its own.
	 */
	static docsPage: ((req: Request) => Response | Promise<Response>) | null =
		null;

	/**
	 * Where the app's links to the developer documentation lead:
	 * `api` = the API reference, `extensions` = the extension guide.
	 */
	static docs = { api: DOCS_URL, extensions: DOCS_URL };

	/**
	 * More topics for the user guide (the MCP tool `read_user_guide`):
	 * topic → its Markdown text. Every shop gets them.
	 */
	static guides: Record<string, string> = {};

	/** The Inertia pages whose HTML is rendered on the server. */
	static ssrPages: string[] = [];

	/**
	 * An add-on's own tables: version → its `up`.
	 * They run after the app's own migrations, in version order.
	 * A version is recorded in `migrations` like any other,
	 * so it must not have the name of one of the app's.
	 */
	static migrations: Record<string, (db: SQL) => Promise<void>> = {};

	/**
	 * The plan of a signed-in user's account, for the layout.
	 * @param user The signed-in user.
	 * @returns The notice, or null when there is nothing to show.
	 */
	static plan: (user: User) => Promise<PlanNotice | null> =
		async function none() {
			return null;
		};

	/**
	 * Called once for every new owner who signed up by themselves.
	 * @param ownerId The new owner's user id.
	 */
	static signedUp: (ownerId: number) => Promise<void> =
		async function nothing() {};

	/**
	 * What the sign-up form shows on top of its own fields.
	 * @returns The note and whether to ask for the terms.
	 */
	static signup: () => SignupInfo = function plain() {
		return { note: null, terms: false };
	};
}
