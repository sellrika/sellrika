import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { Query } from "@xcore/http/Request";
import { json } from "@xcore/http/Response";
import { SearchService } from "@services/Search.Service";

/**
 * The ⌘K global search.
 * Records only: pages are matched in the browser.
 */
@Service()
export class SearchController {
	constructor(private search: SearchService) {}

	/**
	 * JSON: GET /search?q= — a few matching orders, customers,
	 * products… for the palette.
	 * @param req The current request.
	 * @returns The hits per record type (see `SearchService.search`).
	 */
	async index(req: Request) {
		const { shop, user } = ctx(req);
		const q = new Query(req).raw("q") ?? "";
		return json(await this.search.search(shop, user, q));
	}
}
