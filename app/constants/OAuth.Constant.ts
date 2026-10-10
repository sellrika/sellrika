/**
 * OAuth 2.0 sign-in for the MCP server.
 * An assistant sends the shop's admin to a consent page,
 * and gets an ordinary API key back as its access token.
 */

/** The consent page (GET) and its answer (POST). */
export const OAUTH_AUTHORIZE_PATH = "/oauth/authorize";

/** Where a client swaps its one-time code for a key. */
export const OAUTH_TOKEN_PATH = "/oauth/token";

/** Where a client registers itself (RFC 7591). */
export const OAUTH_REGISTER_PATH = "/oauth/register";

/** Says which server signs people in for the MCP server (RFC 9728). */
export const OAUTH_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

/** Says where the sign-in endpoints are (RFC 8414). */
export const OAUTH_SERVER_PATH = "/.well-known/oauth-authorization-server";

/**
 * How long a one-time code may be swapped for a key, in milliseconds.
 * A client swaps it at once, so one minute is plenty.
 */
export const OAUTH_CODE_TTL_MS = 60_000;

/**
 * Most codes kept at once.
 * The oldest is dropped past it, so a script cannot fill the memory.
 */
export const OAUTH_CODES_MAX = 10_000;

/**
 * Redirect addresses one client may register.
 * Gemini sends 6 of them.
 */
export const OAUTH_REDIRECT_URIS_MAX = 10;

/** The longest address a client may send. */
export const OAUTH_URI_MAX = 500;

/** The longest client name. It becomes the key's name. */
export const OAUTH_CLIENT_NAME_MAX = 100;

/** The longest `client_id`: the signed name and redirect addresses. */
export const OAUTH_CLIENT_ID_MAX = 8000;

/** The longest `state` a client may send. It is handed back as it came. */
export const OAUTH_STATE_MAX = 1000;

/** The key's name when the client gave none. */
export const OAUTH_CLIENT_NAME = "MCP client";

/** What a signed `client_id` is signed as. No other signed value passes as one. */
export const OAUTH_CLIENT_KIND = "oauth-client";

/** Hosts a redirect address may use without https: the person's own computer. */
export const OAUTH_LOOPBACK_HOSTS: readonly string[] = [
	"localhost",
	"127.0.0.1",
	"[::1]",
];

/**
 * The CORS headers of the public OAuth endpoints.
 * Any origin may read them: they take no cookie and no key.
 */
export const OAUTH_CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST",
	"Access-Control-Allow-Headers":
		"Content-Type, Authorization, MCP-Protocol-Version",
	"Access-Control-Max-Age": "600",
};
