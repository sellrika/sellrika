/** GitHub's answer about the newest release of the app (not a pre-release). */
export const RELEASE_LATEST_URL =
	"https://api.github.com/repos/sellrika/sellrika/releases/latest";

/** The page of one release: add the tag, like `v1.2.0`. */
export const RELEASE_PAGE_URL =
	"https://github.com/sellrika/sellrika/releases/tag/";

/** When the release check runs: every 6 hours (and once on boot). */
export const RELEASE_CRON = "0 */6 * * *";

/** How long one ask to GitHub may take. */
export const RELEASE_TIMEOUT_MS = 10_000;

/** A release version: `1.2.0`, with or without a `v` in front. */
export const RELEASE_VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;
