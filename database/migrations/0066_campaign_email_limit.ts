import type { SQL } from "bun";

/**
 * The monthly limit on campaign emails sent through the platform's email.
 *   users.campaign_email_limit — set on an owner by the platform admin,
 *     null = the default `PLAN_LIMITS.campaignEmails`
 *   campaign_sends.platform — the email went through the platform's setup,
 *     so it counts toward the limit (a shop's own Shop Email does not)
 */
export async function up(db: SQL) {
	await db.unsafe(`alter table users add column campaign_email_limit integer`);
	await db.unsafe(
		`alter table campaign_sends add column platform boolean not null default false`,
	);
}
