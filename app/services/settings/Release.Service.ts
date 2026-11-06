import { app } from "@config/app";
import {
	RELEASE_LATEST_URL,
	RELEASE_PAGE_URL,
	RELEASE_TIMEOUT_MS,
	RELEASE_VERSION,
} from "@constants/Release.Constant";
import { Service } from "@xcore/di";

/** A newer release than the one that runs. */
export type AppUpdate = {
	/** Its version, like `1.2.0`. */
	version: string;
	/** Its page on GitHub. */
	url: string;
};

/**
 * Knows whether a newer release of the app is out.
 * A job asks GitHub now and then. The answer is kept in memory only.
 * The platform admin's user menu shows a badge for it.
 */
@Service()
export class ReleaseService {
	/** HTTP client. Tests hand in a stub. */
	fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch;
	/** The newest release version GitHub named, like `1.2.0`. Null = not known. */
	latest: string | null = null;

	/**
	 * Ask GitHub for the newest release (the background job).
	 * A failure keeps what was known and never throws.
	 */
	async run() {
		if (!app.updateCheck) return;
		try {
			const res = await this.fetcher(RELEASE_LATEST_URL, {
				headers: {
					Accept: "application/vnd.github+json",
					"User-Agent": "sellrika",
				},
				signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS),
			});
			if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
			const body = (await res.json()) as { tag_name?: unknown };
			const tag = String(body.tag_name ?? "");
			if (!RELEASE_VERSION.test(tag)) throw new Error(`odd tag "${tag}"`);
			this.latest = tag.replace(/^v/, "");
		} catch (e) {
			console.warn(`[release] check failed: ${(e as Error).message}`);
		}
	}

	/**
	 * The newer release, when there is one.
	 * @param current The running version. Defaults to package.json's.
	 * @returns The update, or null when this version is the newest (or unknown).
	 */
	update(current: string = app.version): AppUpdate | null {
		if (!this.latest || !this.#newer(this.latest, current)) return null;
		return { version: this.latest, url: `${RELEASE_PAGE_URL}v${this.latest}` };
	}

	/**
	 * Whether one version is higher than another.
	 * @param a A version like `1.2.0`.
	 * @param b A version like `1.10.0`.
	 * @returns True when `a` is higher. False when either one is not a version.
	 */
	#newer(a: string, b: string) {
		const x = RELEASE_VERSION.exec(a);
		const y = RELEASE_VERSION.exec(b);
		if (!x || !y) return false;
		for (let i = 1; i <= 3; i++) {
			const d = Number(x[i]) - Number(y[i]);
			if (d) return d > 0;
		}
		return false;
	}
}
