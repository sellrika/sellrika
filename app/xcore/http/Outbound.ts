/**
 * Fetching a link someone typed in (a product picture, an extension zip).
 * The server must never be used to reach its own network.
 * So every hop is checked:
 * the name must resolve to public addresses only,
 * redirects are followed by hand and checked again,
 * and the body is cut off at a size cap.
 */

/** How many redirects a link may take before we give up. */
const MAX_REDIRECTS = 3;

/**
 * Fetching a link someone typed in, safely.
 * The server must never be used to reach its own network.
 */
export class Outbound {
	/**
	 * Is this IP (v4 or v6) one the server must not fetch?
	 * @param ip An address as DNS returns it.
	 * @returns True for loopback, private, link-local and reserved addresses.
	 */
	static isPrivateIp(ip: string): boolean {
		if (!ip.includes(":")) return Outbound.#privateV4(ip);
		const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
		// an IPv4 inside IPv6
		const mapped = v6.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
		if (mapped) return Outbound.#privateV4(mapped[1]!);
		return (
			v6 === "::" ||
			v6 === "::1" ||
			// unique local fc00::/7
			/^f[cd]/.test(v6) ||
			// link-local fe80::/10
			/^fe[89ab]/.test(v6) ||
			// multicast
			v6.startsWith("ff") ||
			// mapped, written in hex
			v6.startsWith("::ffff:")
		);
	}

	/**
	 * GET a public https link.
	 * A link, or any redirect, to a private address is refused.
	 * @param url The link.
	 * @param init The timeout signal and request headers.
	 * @param maxBytes The most body bytes to read.
	 * @returns The final response and its body (empty when not ok).
	 *   Null when refused.
	 * @throws Error named `TooLarge` when the body is bigger than `maxBytes`.
	 */
	static async fetch(
		url: string | URL,
		init: { signal?: AbortSignal; headers?: Record<string, string> },
		maxBytes: number,
	): Promise<{ res: Response; bytes: Uint8Array<ArrayBuffer> } | null> {
		let next = new URL(url);
		for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
			if (!(await Outbound.#isPublic(next))) return null;
			const res = await fetch(next, { ...init, redirect: "manual" });
			const location = res.headers.get("location");
			if (res.status >= 300 && res.status < 400 && location) {
				next = new URL(location, next);
				continue;
			}
			if (!res.ok) return { res, bytes: new Uint8Array() };
			return { res, bytes: await Outbound.#readCapped(res, maxBytes) };
		}
		return null;
	}

	/**
	 * Send a request to an address a tenant typed (a webhook).
	 * http or https, no user name in the link, public addresses only,
	 * and a redirect is never followed.
	 * @param url The address.
	 * @param init The usual fetch options.
	 * @returns The response as it came. A redirect is returned, not followed.
	 * @throws When the address is not allowed.
	 */
	static async send(url: string, init: RequestInit = {}): Promise<Response> {
		const u = new URL(url);
		const plain = /^https?:$/.test(u.protocol) && !u.username && !u.password;
		if (!plain || !(await Outbound.isPublicHost(u.hostname)))
			throw new Error(`${u.host}: this address is not allowed`);
		return fetch(u, { ...init, redirect: "manual" });
	}

	/**
	 * Is this IPv4 address inside a private, local or reserved range?
	 * @param ip Dotted IPv4, e.g. `10.0.0.1`.
	 * @returns True when it must not be fetched.
	 */
	static #privateV4(ip: string): boolean {
		const [a = 0, b = 0] = ip.split(".").map(Number);
		return (
			// "this" network
			a === 0 ||
			a === 10 ||
			// loopback
			a === 127 ||
			// carrier-grade NAT
			(a === 100 && b >= 64 && b <= 127) ||
			// link-local, cloud metadata
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			// IETF protocol assignments
			(a === 192 && b === 0) ||
			// benchmarking
			(a === 198 && (b === 18 || b === 19)) ||
			// multicast and reserved
			a >= 224
		);
	}

	/**
	 * Does this link point at a public https address only?
	 * @param url The link.
	 * @returns True when every address the name resolves to is public.
	 */
	static async #isPublic(url: URL): Promise<boolean> {
		if (url.protocol !== "https:" || url.username || url.password) return false;
		return Outbound.isPublicHost(url.hostname);
	}

	/**
	 * Does this host name (or address) lead to public addresses only?
	 * For a place a tenant picks and the server then connects to.
	 * @param hostname A host name or an IP address.
	 * @returns True when every address the name resolves to is public.
	 *   False too when it resolves to nothing.
	 */
	static async isPublicHost(hostname: string): Promise<boolean> {
		const host = hostname.replace(/^\[|\]$/g, "");
		// ponytail: the name is resolved again by fetch().
		// A DNS server that answers differently the second time
		// can still slip through. Pin the IP in fetch if that ever matters.
		const addresses = /^[\d.]+$|:/.test(host)
			? [host]
			: (await Bun.dns.lookup(host).catch(() => [])).map((a) => a.address);
		return addresses.length > 0 && !addresses.some(Outbound.isPrivateIp);
	}

	/**
	 * Read a body, stopping as soon as it passes the cap.
	 * A chunked reply has no length to check first.
	 * @param res The response.
	 * @param maxBytes The most bytes allowed.
	 * @returns The whole body.
	 * @throws Error named `TooLarge` past the cap.
	 */
	static async #readCapped(
		res: Response,
		maxBytes: number,
	): Promise<Uint8Array<ArrayBuffer>> {
		const tooLarge = Object.assign(new Error("Too large"), {
			name: "TooLarge",
		});
		if (Number(res.headers.get("content-length")) > maxBytes) throw tooLarge;
		const chunks: Uint8Array[] = [];
		let size = 0;
		const reader = res.body?.getReader();
		while (reader) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > maxBytes) {
				await reader.cancel();
				throw tooLarge;
			}
			chunks.push(value);
		}
		return new Uint8Array(Bun.concatArrayBuffers(chunks));
	}
}
