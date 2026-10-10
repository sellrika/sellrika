import type { Handler, Middleware } from "@xcore/http/Router";
import { Url } from "@xcore/http/Url";
import { t } from "@xcore/i18n/I18n";
import type { Key } from "@i18n";

/**
 * Fixed-window rate limiting, keyed by bucket name + client IP.
 *
 * A hit is *taken* before the handler runs, in the same step as the check.
 * So a burst of parallel requests can't all pass before any is counted.
 * A response that doesn't count gets its hit back.
 * A shop whose staff sign in all morning should never run out of budget,
 * while ten wrong passwords should.
 *
 * ponytail: an in-process Map.
 * It is correct for the single-process deployment this POS ships as
 * (one container, one binary).
 * Behind several instances each would keep its own count.
 * Move the counters to the DB or Redis if that day comes.
 */
type Window = { hits: number; resetAt: number };

/**
 * How many hits pass between two sweeps.
 * A sweep drops expired windows once in a while,
 * so the Map can't grow without bound under a spray of IPs.
 */
const SWEEP_EVERY = 5_000;

/**
 * The numbers of one bucket.
 * `message` is a dictionary key.
 * It is translated into the caller's language when the budget runs out.
 */
export type RateLimitRule = { limit: number; windowMs: number; message: Key };

/**
 * How a bucket behaves beyond the numbers:
 * what to answer with, and which responses count.
 */
export type RateLimitOptions = {
	/**
	 * Build the 429 yourself.
	 * A form page can show the message inline instead of a bare body.
	 */
	render?: (req: Request, message: string) => Response | Promise<Response>;
	/** Charge the budget only for these responses (default: all of them). */
	counts?: (res: Response) => boolean;
};

/**
 * Fixed-window rate limiting, keyed by bucket name + client IP.
 */
export class RateLimit {
	/** The open windows, by bucket name + caller. */
	static #windows = new Map<string, Window>();
	/** Hits counted since the last sweep. */
	static #sinceSweep = 0;

	/**
	 * Take one hit from a caller's budget.
	 * It is one step, so parallel requests can't all slip through.
	 * @param key Bucket name plus whatever identifies the caller.
	 * @param limit Hits allowed per window.
	 * @param windowMs Window length in milliseconds.
	 * @param now Clock, injectable for tests.
	 * @returns Whether to let the request through
	 *   (nothing is taken when not), and seconds until the window resets.
	 */
	static take(key: string, limit: number, windowMs: number, now = Date.now()) {
		RateLimit.#sweep(now);
		let w = RateLimit.#windows.get(key);
		if (!w || w.resetAt <= now) {
			w = { hits: 0, resetAt: now + windowMs };
			RateLimit.#windows.set(key, w);
		}
		const allowed = w.hits < limit;
		if (allowed) w.hits++;
		return {
			allowed,
			retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)),
		};
	}

	/**
	 * Give back a hit taken for a response that turned out not to count.
	 * @param key Bucket name plus whatever identifies the caller.
	 */
	static refund(key: string) {
		const w = RateLimit.#windows.get(key);
		if (w && w.hits > 0) w.hits--;
	}

	/**
	 * Forget every counter. Tests only.
	 */
	static reset() {
		return RateLimit.#windows.clear();
	}

	/**
	 * Route middleware: refuse a client that is calling this route too often.
	 * @param name Bucket name. Routes sharing a name share a budget.
	 * @param rule How many hits per window,
	 *   and what to tell the caller when it runs out.
	 * @param opts Optional 429 renderer and "which responses count" predicate.
	 * @returns Middleware for `router.group(...)` or a single route.
	 */
	static middleware(
		name: string,
		rule: RateLimitRule,
		opts: RateLimitOptions = {},
	): Middleware {
		return function limited(next: Handler): Handler {
			return async function check(req) {
				const key = `${name}:${Url.clientIp(req)}`;
				const gate = RateLimit.take(key, rule.limit, rule.windowMs);
				if (!gate.allowed) {
					const message = t(rule.message);
					const res = opts.render
						? await opts.render(req, message)
						: new Response(message, {
								status: 429,
								headers: { "Content-Type": "text/plain; charset=utf-8" },
							});
					res.headers.set("Retry-After", String(gate.retryAfter));
					return res;
				}
				const res = await next(req);
				if (opts.counts && !opts.counts(res)) RateLimit.refund(key);
				return res;
			};
		};
	}
	/**
	 * Drop the expired windows, once every `SWEEP_EVERY` hits.
	 * @param now The clock, in milliseconds.
	 */
	static #sweep(now: number) {
		if (++RateLimit.#sinceSweep < SWEEP_EVERY) return;
		RateLimit.#sinceSweep = 0;
		for (const [k, w] of RateLimit.#windows)
			if (w.resetAt <= now) RateLimit.#windows.delete(k);
	}
}
