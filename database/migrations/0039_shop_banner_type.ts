import type { SQL } from "bun";

// `shops.banner_type` — the tone of the announcement strip (info | success | warning | danger, see
// app/constants/Store.Constant.ts › STORE_BANNER_TYPES); every existing banner stays `info`.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table shops add column banner_type text not null default 'info'`,
	);
}
