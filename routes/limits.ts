import { RateLimit } from "@xcore/http/RateLimit";
import { Container } from "@xcore/di";
import { AuthController } from "@controllers/Auth.Controller";
import { RATE_LIMITS } from "@constants/Security.Constant";

/**
 * Abuse limits, per client IP (app/xcore/http/RateLimit.ts).
 * Only the endpoints that cost real work: argon2 verifies,
 * gateway round trips, disk writes, outbound mail,
 * and the customer / address lookups.
 * A route sits in one bucket: `router.group(limit("name"), …)`,
 * or `limit("name")` after the route's action.
 * @param name The bucket, a key of `RATE_LIMITS`.
 * @returns The middleware. Routes that name the same bucket share a budget.
 */
export function limit(name: keyof typeof RATE_LIMITS) {
	return RateLimit.middleware(name, RATE_LIMITS[name]);
}

/**
 * The answer to too many failed sign-ins.
 * The form is shown again with the message inline,
 * instead of a bare 429 body.
 * @param req The current request.
 * @param message Why the sign-in is refused.
 * @returns The sign-in page, with status 429.
 */
function tooManyLogins(req: Request, message: string) {
	return Container.get(AuthController).loginPage(req, { email: message }, 429);
}

/**
 * Does this sign-in answer count against the budget?
 * @param res The answer.
 * @returns False for a 303: that one signed the person in.
 */
function failedLogin(res: Response) {
	return res.status !== 303;
}

/**
 * The sign-in limit.
 * Only *failed* sign-ins burn budget:
 * a shop whose staff log in all morning never runs out.
 */
export const loginLimit = RateLimit.middleware("login", RATE_LIMITS.login, {
	render: tooManyLogins,
	counts: failedLogin,
});
