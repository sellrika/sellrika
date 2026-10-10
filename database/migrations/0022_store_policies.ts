import type { SQL } from "bun";

// Online store legal pages: the merchant writes Terms of Use / Privacy Policy text in /online-store;
// the storefront footer links to /store/<slug>/terms and /privacy when the text is non-empty.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table shops add column store_terms text not null default ''`,
	);
	await db.unsafe(
		`alter table shops add column store_privacy text not null default ''`,
	);
}
