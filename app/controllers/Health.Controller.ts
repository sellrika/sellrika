import { Service } from "@xcore/di";
import { sql } from "@xcore/database/Database";
import { json } from "@xcore/http/Response";

/**
 * Liveness probe for load balancers and `docker healthcheck`.
 */
@Service()
export class HealthController {
	/**
	 * GET /health — is the process up and can it reach the database?
	 * @returns 200 `{ status: "ok" }`, or 503 `{ status: "error" }`.
	 */
	async check() {
		try {
			await sql`select 1`;
			return json({ status: "ok" });
		} catch {
			return json({ status: "error" }, 503);
		}
	}
}
