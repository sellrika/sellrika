import { MANAGER_ONLY_FIELDS } from "@constants/Security.Constant";

/**
 * A value with every cost field set to null, at any depth.
 * For an answer that goes to a cashier: what the shop pays for a product
 * (`purchase_price`) and what a sold line cost (`cost`) are for
 * managers and admins only.
 * The value itself is not changed.
 * @param value Rows, a page of rows, or any JSON-like value.
 * @returns A copy without the cost values.
 */
export function withoutCosts<T>(value: T): T {
	if (Array.isArray(value)) return value.map(withoutCosts) as T;
	if (!value || Object.getPrototypeOf(value) !== Object.prototype) return value;
	const out: Record<string, unknown> = {};
	for (const [key, v] of Object.entries(value))
		out[key] = MANAGER_ONLY_FIELDS.includes(key) ? null : withoutCosts(v);
	return out as T;
}

/**
 * A JSON answer without cost values.
 * Anything that is not JSON is returned as it is.
 * @param res The handler's response.
 * @returns The same answer, cost fields set to null.
 */
export async function responseWithoutCosts(res: Response): Promise<Response> {
	const type = res.headers.get("content-type") ?? "";
	if (!type.startsWith("application/json") || !res.body) return res;
	const headers = new Headers(res.headers);
	headers.delete("content-length");
	return new Response(JSON.stringify(withoutCosts(await res.json())), {
		status: res.status,
		statusText: res.statusText,
		headers,
	});
}
