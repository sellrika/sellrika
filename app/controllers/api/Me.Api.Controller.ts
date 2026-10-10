import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { json } from "@xcore/http/Response";

/**
 * API: who a key is, so a caller can test it.
 */
@Service()
export class MeApiController {
	/**
	 * GET /me — the key, its role right now, and the shop it works in.
	 * @param req The current request.
	 * @returns `{ key, shop }`.
	 */
	show(req: Request) {
		const { user, shop, apiKey } = ctx(req);
		return json({
			key: { id: apiKey?.id, name: apiKey?.name, role: user.role },
			shop: {
				id: shop.id,
				name: shop.name,
				currency: shop.currency,
				timezone: shop.timezone,
			},
		});
	}
}
