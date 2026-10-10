import { app } from "@config/app";
import { HSTS_HEADER, SECURITY_HEADERS } from "@constants/Security.Constant";

/**
 * The security headers every response carries.
 */
export class SecurityHeaders {
	/**
	 * Stamp the security headers onto a response.
	 * Applied by the router to every route,
	 * so a new handler can never forget them.
	 * @param req The request being answered. It decides whether HSTS applies.
	 * @param res The handler's response.
	 * @returns The same response, headers added.
	 *   Values a handler set itself are left alone.
	 */
	static apply(req: Request, res: Response): Response {
		try {
			for (const [k, v] of Object.entries(SECURITY_HEADERS))
				if (!res.headers.has(k)) res.headers.set(k, v);
			// Only meaningful over TLS, and only safe to promise in production
			if (
				app.isProd &&
				new URL(req.url).protocol === "https:" &&
				!res.headers.has("Strict-Transport-Security")
			) {
				res.headers.set("Strict-Transport-Security", HSTS_HEADER);
			}
		} catch {
			// Response.redirect()/Response.error() have immutable headers.
			// Nothing to add there anyway.
		}
		return res;
	}
}
