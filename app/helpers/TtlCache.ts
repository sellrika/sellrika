/**
 * A small in-memory cache: each value lives for a fixed time.
 * For numbers and lists that are slow to read and fine a little old.
 * It lives in this process only. A restart empties it.
 */
export class TtlCache<K, V> {
	#items = new Map<K, { value: V; until: number }>();

	/**
	 * Counts the `delete` calls.
	 * A read that started before a delete must not be kept:
	 * its value may be older than the change.
	 */
	#deletes = 0;

	/**
	 * @param ttlMs How long a value is kept, in milliseconds.
	 */
	constructor(private ttlMs: number) {}

	/**
	 * The value of a key: the kept one, else a fresh one.
	 * @param key What the value belongs to, e.g. a shop id.
	 * @param load Reads the value when none is kept.
	 * @returns The value.
	 */
	async get(key: K, load: () => Promise<V>): Promise<V> {
		const hit = this.#items.get(key);
		if (hit && hit.until > Date.now()) return hit.value;
		const deletes = this.#deletes;
		const value = await load();
		if (deletes === this.#deletes)
			this.#items.set(key, { value, until: Date.now() + this.ttlMs });
		return value;
	}

	/**
	 * Forget the value of a key. The next `get` reads it again.
	 * @param key What the value belongs to.
	 */
	delete(key: K) {
		this.#deletes++;
		this.#items.delete(key);
	}
}
