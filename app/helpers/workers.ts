/**
 * Work through a queue with a few workers at the same time.
 * Every worker takes the next item as soon as it is free.
 * They stop when `take` says the queue is empty.
 * A job that throws stops only its own worker.
 * The others finish the queue, then the first error is thrown.
 * @param count How many workers.
 * @param take Take the next item off the queue (e.g. from `email_queue`).
 * null = empty.
 * @param job The work for one item.
 */
export async function workers<T>(
	count: number,
	take: () => Promise<T | null>,
	job: (item: T) => Promise<unknown>,
) {
	/** One worker: take the next item, do it, repeat. */
	async function worker() {
		for (let next = await take(); next !== null; next = await take())
			await job(next);
	}
	const results = await Promise.allSettled(
		Array.from({ length: count }, worker),
	);
	const failed = results.find(isRejected);
	if (failed) throw failed.reason;
}

/**
 * Did this worker stop on an error?
 * @param r One worker's result.
 * @returns True when it threw.
 */
function isRejected(
	r: PromiseSettledResult<unknown>,
): r is PromiseRejectedResult {
	return r.status === "rejected";
}
