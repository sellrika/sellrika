import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { json } from "@xcore/http/Response";
import { UserService } from "@services/settings/User.Service";

/**
 * API: the staff accounts of the key's account. Read only.
 * ponytail: no create / edit / delete here.
 * A leaked key must not be able to make itself a login.
 * Add them behind an admin-only key when a real integration needs it;
 * `UserService` already holds the rules.
 */
@Service()
export class StaffApiController {
	constructor(private users: UserService) {}

	/**
	 * GET /staff — everyone who can sign in to the account. Never a password.
	 * @param req The current request.
	 * @returns The staff accounts.
	 */
	async index(req: Request) {
		return json(await this.users.list(ctx(req).user));
	}
}
