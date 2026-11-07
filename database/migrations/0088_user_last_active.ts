import type { SQL } from "bun";

/**
 * When a user last used the app.
 *   last_active_at — the last signed-in request, null = never seen
 * It is written at most once every few minutes (USER_SEEN_EVERY_MS).
 * The platform admin sees it on the shop owners pages.
 */
export async function up(db: SQL) {
	await db.unsafe(`alter table users add column last_active_at timestamp`);
}
