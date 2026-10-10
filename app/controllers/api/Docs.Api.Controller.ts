import { Service } from "@xcore/di";
import { apiDocs, OpenApi } from "@xcore/api/OpenApi";
import { json } from "@xcore/http/Response";
import { Url } from "@xcore/http/Url";
import { ApiSchemas } from "@validators/ApiResponse.Validator";
import {
	API_DESCRIPTION,
	API_PREFIX,
	API_TAGS,
	API_TITLE,
	API_VERSION,
	MCP_PATH,
	OPENAPI_CACHE_MAX,
} from "@constants/Api.Constant";

/**
 * The API's own description: the OpenAPI file, built from the routes.
 * It is public.
 * The pages that explain the API are not part of the source-available app
 * (`DOCS_URL`).
 */
@Service()
export class DocsApiController {
	/**
	 * The built OpenAPI document per origin.
	 * The routes never change after boot, so it is built once.
	 */
	#specs = new Map<string, unknown>();

	/**
	 * GET /api/v1/openapi.json — the OpenAPI 3.1 file, built from the routes.
	 * @param req The current request.
	 * @returns The OpenAPI document.
	 */
	spec(req: Request) {
		// on the docs host the API is still at the app's own address
		const origin = Url.isDeveloperHost(req)
			? Url.appOrigin()
			: Url.originOf(req);
		let spec = this.#specs.get(origin);
		if (!spec) {
			spec = this.#build(origin);
			if (this.#specs.size >= OPENAPI_CACHE_MAX) this.#specs.clear();
			this.#specs.set(origin, spec);
		}
		return json(spec);
	}

	/**
	 * Build the OpenAPI document for one origin.
	 * @param origin Where the API answers, e.g. `https://sellrika.com`.
	 * @returns The document.
	 */
	#build(origin: string) {
		return OpenApi.build({
			title: API_TITLE,
			version: API_VERSION,
			description: API_DESCRIPTION.replaceAll(
				"{mcp_url}",
				`${origin}${MCP_PATH}`,
			),
			server: `${origin}${API_PREFIX}`,
			tags: API_TAGS,
			schemas: ApiSchemas,
			docs: apiDocs,
		});
	}
}
