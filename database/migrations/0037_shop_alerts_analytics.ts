import type { SQL } from "bun";

// New-order alerts to the owner (app/services/sales/OrderAlert.Service.ts): alert_email (null = off),
// telegram_bot_token (AES-256-GCM with APP_KEY, never selected into page props) + telegram_chat_id (null = off).
// Analytics printed on every store page (Store.Controller.ts › seo): ga_id (GA4 "G-…"), meta_pixel_id.
export async function up(db: SQL) {
	for (const col of [
		"alert_email",
		"telegram_bot_token",
		"telegram_chat_id",
		"ga_id",
		"meta_pixel_id",
	])
		await db.unsafe(`alter table shops add column ${col} text`);
}
