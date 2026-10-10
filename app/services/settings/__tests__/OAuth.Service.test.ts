import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
import { API_KEY_MAX, API_KEY_PREFIX } from "@constants/Api.Constant";
import { OAUTH_CODE_TTL_MS } from "@constants/OAuth.Constant";

// Temp SQLite DB (never the real one); db.ts reads DB_FILE at import.
process.env.DB_FILE = `${tmpdir()}/pos-oauth-test-${process.pid}.db`;
process.env.APP_KEY ??= "oauth-test-key";
const { sql } = await import("@xcore/database/Database");
const registry = await import("@database/migrations");
const { app } = await import("@config/app");
const { pkceChallenge, signed } = await import("@helpers/crypto");
const { OAuthService: _OAuthService } = await import("../OAuth.Service");
const OAuthService = Container.get(_OAuthService);
const { ApiKeyService: _ApiKeyService } = await import("../ApiKey.Service");
const ApiKeyService = Container.get(_ApiKeyService);
const { UserRepository: _UserRepository } = await import(
	"@repositories/User.Repository"
);
const UserRepository = Container.get(_UserRepository);
const { ShopRepository: _ShopRepository } = await import(
	"@repositories/Shop.Repository"
);
const ShopRepository = Container.get(_ShopRepository);

const migrated = await sql`select 1 from users`.then(
	() => true,
	() => false,
);
if (!migrated)
	for (const [, up] of Object.entries(registry).sort(([a], [b]) =>
		a.localeCompare(b),
	))
		await up(sql);

const tag = `${process.pid}-${Date.now()}`;

/**
 * A new owner with one shop.
 * @param name Used in the email and the shop's slug.
 * @returns The owner and their shop.
 */
async function ownerWithShop(name: string) {
	const user = await UserRepository.create(
		{ name, email: `oauth-${name}-${tag}@x.io`, role: "admin", password: "" },
		"x",
		null,
	);
	const [row] =
		await sql`insert into shops (name, slug, currency, timezone, owner_id) values (${name}, ${`oauth-${name}-${tag}`}, 'USD', 'UTC', ${user.id}) returning id`;
	const shop = await ShopRepository.findOwned(row.id as number, user.id);
	if (!shop) throw new Error("no shop");
	return { user, shop };
}

const mine = await ownerWithShop("mine");
const theirs = await ownerWithShop("theirs");

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "v".repeat(43);

/**
 * Register a client and build what it sends to the consent page.
 * @returns The client and the request the admin allows.
 */
function asked() {
	const made = OAuthService.register({
		redirect_uris: [REDIRECT],
		client_name: "Claude",
	});
	if (!made) throw new Error("not registered");
	const client = OAuthService.client(made.client_id, REDIRECT);
	if (!client) throw new Error("no client");
	const d = {
		response_type: "code" as const,
		client_id: made.client_id,
		redirect_uri: REDIRECT,
		code_challenge: pkceChallenge(VERIFIER),
		code_challenge_method: "S256" as const,
		state: "abc",
		role: "manager" as const,
	};
	return { client, d };
}

/**
 * Let the admin allow a client, and read the code from the address.
 * @returns The one-time code and the request.
 */
async function allowed() {
	const { client, d } = asked();
	const r = await OAuthService.approve(mine.user, mine.shop, client, d);
	if (!("url" in r)) throw new Error(r.error);
	const url = new URL(r.url);
	return { code: url.searchParams.get("code") ?? "", url, d };
}

/**
 * The token request of a client.
 * @param code The one-time code.
 * @param d The request the code was made for.
 * @returns The body of `POST /oauth/token`.
 */
function swap(code: string, d: { client_id: string }) {
	return {
		grant_type: "authorization_code" as const,
		code,
		code_verifier: VERIFIER,
		redirect_uri: REDIRECT,
		client_id: d.client_id,
	};
}

test("allow a client: the code goes back with the state, and is swapped once for a key of that shop and role", async () => {
	const { code, url, d } = await allowed();
	expect(url.origin + url.pathname).toBe(REDIRECT);
	expect(url.searchParams.get("state")).toBe("abc");

	const token = await OAuthService.exchange(swap(code, d));
	expect(token?.startsWith(API_KEY_PREFIX)).toBe(true);
	const caller = await ApiKeyService.authenticate(token!);
	expect(caller?.shop.id).toBe(mine.shop.id);
	expect(caller?.user).toMatchObject({ id: mine.user.id, role: "manager" });
	// the key is an ordinary one, on the keys page.
	// Its name carries the host the code went to: a client can not make that up
	const [listed] = await ApiKeyService.list(mine.shop.id);
	expect(listed).toMatchObject({ name: "Claude (claude.ai)", role: "manager" });

	// a code works once
	expect(await OAuthService.exchange(swap(code, d))).toBeNull();
});

test("a swap is refused, and the code is used up, when anything does not match", async () => {
	const wrongSecret = await allowed();
	const bad = {
		...swap(wrongSecret.code, wrongSecret.d),
		code_verifier: "x".repeat(43),
	};
	expect(await OAuthService.exchange(bad)).toBeNull();
	// the right secret no longer helps: the code is gone
	expect(
		await OAuthService.exchange(swap(wrongSecret.code, wrongSecret.d)),
	).toBeNull();

	const wrongAddress = await allowed();
	expect(
		await OAuthService.exchange({
			...swap(wrongAddress.code, wrongAddress.d),
			redirect_uri: "https://evil.example/cb",
		}),
	).toBeNull();

	// another client can not use the code
	const wrongClient = await allowed();
	const other = OAuthService.register({ redirect_uris: [REDIRECT] });
	expect(
		await OAuthService.exchange(swap(wrongClient.code, other!)),
	).toBeNull();

	expect(
		await OAuthService.exchange(swap("no-such-code", asked().d)),
	).toBeNull();
});

test("a code is too old after a minute, and dies when its admin is no longer one", async () => {
	const old = await allowed();
	const now = Date.now;
	Date.now = () => now() + OAUTH_CODE_TTL_MS + 1;
	try {
		expect(await OAuthService.exchange(swap(old.code, old.d))).toBeNull();
	} finally {
		Date.now = now;
	}

	const demoted = await allowed();
	await sql`update users set role = 'cashier' where id = ${mine.user.id}`;
	try {
		expect(
			await OAuthService.exchange(swap(demoted.code, demoted.d)),
		).toBeNull();
	} finally {
		await sql`update users set role = 'admin' where id = ${mine.user.id}`;
	}
});

test("a client: only https or the own computer, and only an id this server signed", () => {
	for (const uri of [
		"http://evil.example/cb",
		"javascript:alert(1)",
		"data:text/html,x",
		"https://ok.example/cb#frag",
		"https://user:pw@ok.example/cb",
		"not a url",
	])
		expect(OAuthService.register({ redirect_uris: [uri] })).toBeNull();
	// one bad address refuses the whole client
	expect(
		OAuthService.register({ redirect_uris: [REDIRECT, "http://evil.example"] }),
	).toBeNull();
	const local = OAuthService.register({
		redirect_uris: ["http://localhost:53124/callback"],
	});
	expect(local?.client_name).toBe("MCP client");

	const { d } = asked();
	// an address the client did not register
	expect(
		OAuthService.client(d.client_id, "https://evil.example/cb"),
	).toBeNull();
	// a changed id, and a value signed for something else
	expect(OAuthService.client(`${d.client_id}x`, REDIRECT)).toBeNull();
	expect(OAuthService.client("nope", REDIRECT)).toBeNull();
	const forged = signed(
		"other-kind",
		JSON.stringify({ name: "x", redirect_uris: [REDIRECT] }),
	);
	expect(OAuthService.client(forged, REDIRECT)).toBeNull();
});

test("the shop: a shop's own MCP address means that shop, and never a shop of another account", async () => {
	const { user, shop } = mine;
	const hostOf = (slug: string | null) =>
		`https://${slug}.${app.domains.store}/mcp`;
	expect((await OAuthService.shopFor(user, shop))?.id).toBe(shop.id);
	// the app's own address, or a broken one: the active shop
	expect(
		(await OAuthService.shopFor(user, shop, "https://app.example/mcp"))?.id,
	).toBe(shop.id);
	expect((await OAuthService.shopFor(user, shop, "::"))?.id).toBe(shop.id);
	expect((await OAuthService.shopFor(user, shop, hostOf(shop.slug)))?.id).toBe(
		shop.id,
	);
	expect(
		await OAuthService.shopFor(user, shop, hostOf(theirs.shop.slug)),
	).toBeNull();
});

test("a shop with all its keys gets no code", async () => {
	const { client, d } = asked();
	while (!(await ApiKeyService.full(theirs.shop.id)))
		await ApiKeyService.create(theirs.shop.id, theirs.user, {
			name: "k",
			role: "cashier",
		});
	const r = await OAuthService.approve(theirs.user, theirs.shop, client, d);
	expect(r).toEqual({ error: `A shop can have at most ${API_KEY_MAX} keys.` });
});
