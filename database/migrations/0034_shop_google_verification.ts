import type { SQL } from "bun";

// Google Search Console ownership token: the `content` of the <meta name="google-site-verification">
// tag the owner copies from Search Console; every store page prints it (Store.Controller.ts › seo).
export async function up(db: SQL) {
	await db.unsafe(`alter table shops add column google_site_verification text`);
}
