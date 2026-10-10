import { Account } from "@xcore/auth/Account";
import { Url } from "@xcore/http/Url";
import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import {
	pkceChallenge,
	randomToken,
	readSigned,
	signed,
} from "@helpers/crypto";
import { ShopRepository } from "@repositories/Shop.Repository";
import { UserRepository } from "@repositories/User.Repository";
import { ApiKeyService } from "@services/settings/ApiKey.Service";
import type { Shop } from "@models/Shop";
import type { User } from "@models/User";
import type {
	OAuthApproveInput,
	OAuthRegisterInput,
	OAuthTokenInput,
} from "@validators/OAuth.Validator";
import { API_KEY_MAX } from "@constants/Api.Constant";
import {
	OAUTH_CLIENT_KIND,
	OAUTH_CLIENT_NAME,
	OAUTH_CLIENT_NAME_MAX,
	OAUTH_CODE_TTL_MS,
	OAUTH_CODES_MAX,
	OAUTH_LOOPBACK_HOSTS,
} from "@constants/OAuth.Constant";
import type { Role } from "@constants/User.Constant";

/** A registered client: what its signed `client_id` holds. */
export type OAuthClient = { name: string; redirect_uris: string[] };

/**
 * A one-time code the consent page handed out and still waits for.
 * It holds what the key will be: for whom, in which shop, with which role.
 */
type Pending = {
	clientId: string;
	redirectUri: string;
	challenge: string;
	userId: number;
	shopId: number;
	role: Role;
	name: string;
	expires: number;
};

/**
 * OAuth 2.0 sign-in for the MCP server.
 * The admin allows a client on the consent page.
 * The client then swaps a one-time code for an ordinary API key.
 * So the key's rules (role, shop, limits, delete) are the only rules.
 */
@Service()
export class OAuthService {
	/**
	 * The codes waiting to be swapped, oldest first.
	 * ponytail: kept in memory, fine for one server process.
	 * Move them to a table when the app runs as several.
	 */
	private codes = new Map<string, Pending>();

	constructor(
		private keys: ApiKeyService,
		private users: UserRepository,
		private shops: ShopRepository,
	) {}

	/**
	 * Add query values to an address.
	 * @param uri The address.
	 * @param params The values. An undefined one is left out.
	 * @returns The address with the values added.
	 */
	static withQuery(uri: string, params: Record<string, string | undefined>) {
		const url = new URL(uri);
		for (const [name, value] of Object.entries(params))
			if (value !== undefined) url.searchParams.set(name, value);
		return url.toString();
	}

	/**
	 * Register a client.
	 * Nothing is stored: the `client_id` is the client's own data, signed.
	 * @param d Validated name and redirect addresses.
	 * @returns The client as the answer of RFC 7591.
	 *   Null when a redirect address is not allowed.
	 */
	register(d: OAuthRegisterInput) {
		if (!d.redirect_uris.every((uri) => this.#allowed(uri))) return null;
		const client: OAuthClient = {
			name: d.client_name || OAUTH_CLIENT_NAME,
			redirect_uris: d.redirect_uris,
		};
		return {
			client_id: signed(OAUTH_CLIENT_KIND, JSON.stringify(client)),
			client_name: client.name,
			redirect_uris: client.redirect_uris,
			grant_types: ["authorization_code"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		};
	}

	/**
	 * Read a client back from its `client_id`.
	 * @param clientId The id `register` handed out.
	 * @param redirectUri Where the client wants the person sent back to.
	 * @returns The client. Null when the id is not ours,
	 *   or the address is not one it registered.
	 */
	client(clientId: string, redirectUri: string): OAuthClient | null {
		const text = readSigned(OAUTH_CLIENT_KIND, clientId);
		if (!text) return null;
		const client = JSON.parse(text) as OAuthClient;
		return client.redirect_uris.includes(redirectUri) ? client : null;
	}

	/**
	 * The shop a client will work in.
	 * A shop's own MCP address means that shop.
	 * Any other address means the admin's active shop.
	 * @param user The admin on the consent page.
	 * @param active Their active shop.
	 * @param resource The MCP address the client named, if any.
	 * @returns The shop. Null when the address is a shop of another account.
	 */
	async shopFor(user: User, active: Shop, resource?: string) {
		const host = this.#hostOf(resource);
		const named = host ? await this.shops.findByHost(host) : null;
		if (!named) return active;
		return this.shops.findOwned(named.id, Account.id(user));
	}

	/**
	 * The admin allows the client: make its one-time code.
	 * The key itself is made later, when the client swaps the code.
	 * @param user The admin.
	 * @param shop The shop the key will work in (`shopFor`).
	 * @param client The client (`client`).
	 * @param d The validated request, with the role.
	 * @returns `{url}` = where to send the person back, with the code.
	 *   Or `{error}` when the shop can hold no more keys.
	 */
	async approve(
		user: User,
		shop: Shop,
		client: OAuthClient,
		d: OAuthApproveInput,
	): Promise<{ url: string } | { error: string }> {
		if (await this.keys.full(shop.id))
			return { error: t("api_keys.too_many", { max: API_KEY_MAX }) };
		const now = Date.now();
		for (const [key, pending] of this.codes) {
			const full = this.codes.size >= OAUTH_CODES_MAX;
			if (pending.expires > now && !full) break;
			this.codes.delete(key);
		}
		const code = randomToken(32);
		this.codes.set(code, {
			clientId: d.client_id,
			redirectUri: d.redirect_uri,
			challenge: d.code_challenge,
			userId: user.id,
			shopId: shop.id,
			role: d.role,
			// the host is the part a client can not make up
			name: `${client.name} (${new URL(d.redirect_uri).host})`.slice(
				0,
				OAUTH_CLIENT_NAME_MAX,
			),
			expires: now + OAUTH_CODE_TTL_MS,
		});
		return {
			url: OAuthService.withQuery(d.redirect_uri, { code, state: d.state }),
		};
	}

	/**
	 * Swap a one-time code for an API key.
	 * The code works once, also when the swap is refused.
	 * The client, the redirect address and the PKCE secret must all match
	 * what the consent page saw.
	 * @param d The validated token request.
	 * @returns The key, or null when anything does not match.
	 */
	async exchange(d: OAuthTokenInput) {
		const pending = this.codes.get(d.code);
		if (!pending) return null;
		this.codes.delete(d.code);
		if (
			pending.expires <= Date.now() ||
			pending.clientId !== d.client_id ||
			pending.redirectUri !== d.redirect_uri ||
			pending.challenge !== pkceChallenge(d.code_verifier)
		)
			return null;
		// the minute between the consent and the swap: still an admin of the shop?
		const user = await this.users.find(pending.userId);
		if (!user?.active || user.role !== "admin") return null;
		if (!(await this.shops.findOwned(pending.shopId, Account.id(user))))
			return null;
		const made = await this.keys.create(pending.shopId, user, {
			name: pending.name,
			role: pending.role,
		});
		return made.errors ? null : made.token;
	}

	/**
	 * The origin of the MCP server a request reached.
	 * A shop's own host is used as it was sent: it was matched to a shop.
	 * Any other host is the app's own address.
	 * The host is read back through `URL`, so nothing but a clean origin
	 * ever lands in a header.
	 * @param req The current request.
	 * @returns The origin, without a path.
	 */
	async mcpOrigin(req: Request) {
		if (!(await this.shops.findByHost(Url.hostOf(req))))
			return Url.originOf(req);
		try {
			return new URL(Url.requestOrigin(req)).origin;
		} catch {
			return Url.originOf(req);
		}
	}

	/**
	 * May a client ask to be sent back to this address?
	 * Only https, or http on the person's own computer.
	 * So a code never travels in the clear, and never to a script address.
	 * ponytail: no app links (`cursor://…`). Add a list of schemes when a client needs one.
	 * @param uri The address.
	 * @returns True when it is allowed.
	 */
	#allowed(uri: string) {
		try {
			const url = new URL(uri);
			if (url.hash || url.username || url.password) return false;
			if (url.protocol === "https:") return true;
			return (
				url.protocol === "http:" && OAUTH_LOOPBACK_HOSTS.includes(url.hostname)
			);
		} catch {
			return false;
		}
	}

	/**
	 * The host name of an address.
	 * @param uri The address, if any.
	 * @returns The host, lower case. "" when there is none or it is broken.
	 */
	#hostOf(uri?: string) {
		try {
			return uri ? new URL(uri).hostname.toLowerCase() : "";
		} catch {
			return "";
		}
	}
}
