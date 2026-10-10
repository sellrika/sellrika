import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { HttpResponse, json } from "@xcore/http/Response";
import { inertia } from "@xcore/view/Inertia";
import { PostalCodeService } from "@services/sales/PostalCode.Service";
import { PlacesQuery, PostalDownloadInput } from "@validators/Store.Validator";
import { PostalCodeRepository } from "@repositories/PostalCode.Repository";
import { COUNTRIES } from "@constants/Country.Constant";
import { validate } from "@validators/validate";

/**
 * The cities / postal codes download on /postal-codes (Settings, admin).
 * The list is global: every shop's checkout reads it.
 */
@Service()
export class PostalCodeController {
	constructor(
		private postal: PostalCodeService,
		private repo: PostalCodeRepository,
	) {}

	/**
	 * JSON: GET /online-store/delivery/places
	 * ?countries=…&countries=…&q=&of=cities|states
	 * — the downloaded cities (or states / provinces) matching `q`.
	 * An empty `q` gives the first page A–Z.
	 * `countries` holds country names, repeated.
	 * None = a rest-of-world zone, so every downloaded country.
	 * It feeds a zone's Cities / States chips.
	 * `more` = there are others: type to find them.
	 * @param req The current request.
	 * @returns `{ places: string[], more }`.
	 */
	async places(req: Request) {
		ctx(req);
		const sp = new URL(req.url).searchParams;
		const v = validate(PlacesQuery, {
			countries: sp.getAll("countries"),
			q: sp.get("q") ?? "",
			of: sp.get("of") ?? "cities",
		});
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		const codes = COUNTRIES.filter((c) =>
			v.data.countries.includes(c.name),
		).map((c) => c.code);
		if (!codes.length && v.data.countries.length)
			return json({ places: [], more: false });
		return json(
			v.data.of === "states"
				? await this.repo.regions(codes, v.data.q)
				: await this.repo.places(codes, v.data.q),
		);
	}

	/**
	 * GET /postal-codes — the download page.
	 * Its status comes from /postal-codes/status.
	 * @param req The current request.
	 * @returns The PostalCodes/Index page.
	 */
	index(req: Request) {
		return inertia(req, "PostalCodes/Index", {});
	}

	/**
	 * JSON: GET /postal-codes/status — where the download stands.
	 * The page polls it while one runs.
	 * @returns The `PostalStatus`.
	 */
	async status() {
		return json(await this.postal.status());
	}

	/**
	 * JSON: POST /postal-codes — start (or redo) a download.
	 * The body is `{ scope: "country", country }` or `{ scope: "all" }`.
	 * @param req The current request.
	 * @returns 202 with the starting status, or 422 `{ errors: { scope } }`.
	 */
	async download(req: Request) {
		// admin route: the list is global, no shop involved
		ctx(req);
		const v = validate(PostalDownloadInput, await HttpRequest.body(req));
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		const r = await this.postal.start(v.data.scope, v.data.country);
		return r.error
			? HttpResponse.unprocessable({ scope: r.error })
			: json(r.status, 202);
	}

	/**
	 * JSON: POST /postal-codes/cancel — stop the download in flight.
	 * It is for one that looks stuck.
	 * @returns The status after.
	 */
	async cancel() {
		return json(await this.postal.cancel());
	}

	/**
	 * JSON: DELETE /postal-codes/:code — drop a downloaded country.
	 * Its rows and its date go.
	 * @param req The current request. `code` = ISO code from the table.
	 * @returns The status after, or 422 `{ errors: { scope } }`
	 *   while a download runs.
	 */
	async remove(req: BunRequest<"/postal-codes/:code">) {
		ctx(req);
		const r = await this.postal.remove(req.params.code);
		return r.error
			? HttpResponse.unprocessable({ scope: r.error })
			: json(r.status);
	}
}
