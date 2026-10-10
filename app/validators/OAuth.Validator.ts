import { z } from "zod";
import {
	OAUTH_CLIENT_ID_MAX,
	OAUTH_CLIENT_NAME_MAX,
	OAUTH_REDIRECT_URIS_MAX,
	OAUTH_STATE_MAX,
	OAUTH_URI_MAX,
} from "@constants/OAuth.Constant";
import { ROLES } from "@constants/User.Constant";

/** An address a client sent. What it may be is checked in the service. */
const uri = z.string().trim().min(1).max(OAUTH_URI_MAX);

/** The signed `client_id` that `POST /oauth/register` handed out. */
const clientId = z.string().min(1).max(OAUTH_CLIENT_ID_MAX);

/** A client registers itself. POST /oauth/register. */
export const OAuthRegisterInput = z.object({
	/** Where the person may be sent back to. */
	redirect_uris: z.array(uri).min(1).max(OAUTH_REDIRECT_URIS_MAX),
	/** The name the consent page shows. */
	client_name: z.string().trim().max(OAUTH_CLIENT_NAME_MAX).optional(),
});
/** A checked `OAuthRegisterInput`. */
export type OAuthRegisterInput = z.infer<typeof OAuthRegisterInput>;

/** What a client asks the consent page for. GET /oauth/authorize. */
export const OAuthAuthorizeInput = z.object({
	response_type: z.literal("code"),
	client_id: clientId,
	redirect_uri: uri,
	/** PKCE: the SHA-256 of the client's secret, base64url (43 symbols). */
	code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	code_challenge_method: z.literal("S256"),
	/** Handed back to the client as it came. */
	state: z.string().max(OAUTH_STATE_MAX).optional(),
	/** The MCP server the client wants to call. It picks the shop. */
	resource: uri.optional(),
});
/** A checked `OAuthAuthorizeInput`. */
export type OAuthAuthorizeInput = z.infer<typeof OAuthAuthorizeInput>;

/** The admin allows it. POST /oauth/authorize. */
export const OAuthApproveInput = OAuthAuthorizeInput.extend({
	/** The most the client may do. */
	role: z.enum(ROLES, { message: "validation.pick_a_role" }),
});
/** A checked `OAuthApproveInput`. */
export type OAuthApproveInput = z.infer<typeof OAuthApproveInput>;

/** A client swaps its code for a key. POST /oauth/token. */
export const OAuthTokenInput = z.object({
	grant_type: z.literal("authorization_code"),
	code: z.string().min(1).max(200),
	/** PKCE: the secret whose hash was sent to the consent page. */
	code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
	redirect_uri: uri,
	client_id: clientId,
});
/** A checked `OAuthTokenInput`. */
export type OAuthTokenInput = z.infer<typeof OAuthTokenInput>;
