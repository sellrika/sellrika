import { expect, test } from "bun:test";
import { workers } from "@helpers/workers";

/**
 * A queue over a list, the way `email_queue` hands out rows.
 * @param items The items.
 * @returns `take()`: the next item, or null when empty.
 */
function queueOf<T>(items: T[]) {
	const left = [...items];
	return async function take() {
		return left.shift() ?? null;
	};
}

test("workers: every item once, never more than `count` at the same time", async () => {
	const done: number[] = [];
	let busy = 0;
	let most = 0;
	/**
	 * A job that takes a moment, so the workers overlap.
	 * @param n The item.
	 */
	async function job(n: number) {
		most = Math.max(most, ++busy);
		await Bun.sleep(n % 3);
		done.push(n);
		busy--;
	}
	await workers(5, queueOf([...Array(20).keys()]), job);
	expect(done.toSorted((a, b) => a - b)).toEqual([...Array(20).keys()]);
	expect(most).toBe(5);
});

test("workers: an error stops one worker, the others finish the queue, then it is thrown", async () => {
	const done: number[] = [];
	/**
	 * Fails on item 2.
	 * @param n The item.
	 */
	async function job(n: number) {
		await Bun.sleep(1);
		if (n === 2) throw new Error("boom");
		done.push(n);
	}
	await expect(workers(2, queueOf([0, 1, 2, 3, 4, 5]), job)).rejects.toThrow(
		"boom",
	);
	expect(done.toSorted()).toEqual([0, 1, 3, 4, 5]);
});
