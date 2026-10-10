/** The last job queued per key; the next job for that key waits for it. */
const tails = new Map<string, Promise<unknown>>();

/**
 * Run jobs with the same key one after another, never at the same time.
 * Jobs with different keys still run side by side.
 * ponytail: in-process only.
 * Right for the single-process deployment (like the rate limits).
 * Move to a DB lock if the app ever runs as several instances.
 * @param key What the jobs must not overlap on (e.g. one discount code).
 * @param job The work.
 * @returns What the job returns (or throws).
 */
export async function oneAtATime<T>(
	key: string,
	job: () => Promise<T>,
): Promise<T> {
	const before = tails.get(key) ?? Promise.resolve();
	const run = before.then(job);
	const tail = run.catch(ignore);
	tails.set(key, tail);
	try {
		return await run;
	} finally {
		if (tails.get(key) === tail) tails.delete(key);
	}
}

/** Swallow an error: the job's own caller already gets it. */
function ignore() {}
