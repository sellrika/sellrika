import {
	COMPRESS_CACHE_MAX,
	COMPRESS_MIN_BYTES,
	COMPRESSIBLE_TYPES,
} from "@constants/Http.Constant";

/**
 * Gzip for text-like responses.
 */
export class Compress {
	/**
	 * Gzipped bytes of hashed build files.
	 * Their URL changes when their content does, so this never goes stale.
	 */
	static #cached = new Map<string, Uint8Array<ArrayBuffer>>();

	/**
	 * Gzip a text-like response when the client accepts it.
	 * Bun.serve sends bodies as they are,
	 * and the production proxy compresses nothing.
	 * So this is the one place the wire gets smaller.
	 * Bodies that are small, binary, already encoded or empty
	 * pass through untouched.
	 * @param req The request. It is read for `Accept-Encoding`.
	 * @param res The handler's response.
	 * @param cacheKey Set for immutable files (the `/build/*` output)
	 *   to gzip each one only once.
	 * @returns The same response, or a gzipped copy with `Content-Encoding: gzip`.
	 */
	static async gzip(
		req: Request,
		res: Response,
		cacheKey?: string,
	): Promise<Response> {
		const type = res.headers.get("content-type") ?? "";
		if (
			!res.body ||
			res.status === 204 ||
			res.status === 304 ||
			res.headers.has("content-encoding") ||
			!COMPRESSIBLE_TYPES.test(type) ||
			!/\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")
		)
			return res;
		let gz = cacheKey ? Compress.#cached.get(cacheKey) : undefined;
		if (!gz) {
			const raw = new Uint8Array(await res.arrayBuffer());
			if (raw.byteLength < COMPRESS_MIN_BYTES) return new Response(raw, res);
			gz = Bun.gzipSync(raw);
			// ponytail: a full cache stops growing, no eviction. Build files are few.
			if (cacheKey && Compress.#cached.size < COMPRESS_CACHE_MAX)
				Compress.#cached.set(cacheKey, gz);
		}
		const headers = new Headers(res.headers);
		headers.set("content-encoding", "gzip");
		headers.set("content-length", String(gz.byteLength));
		headers.append("vary", "Accept-Encoding");
		return new Response(gz, {
			status: res.status,
			statusText: res.statusText,
			headers,
		});
	}
}
