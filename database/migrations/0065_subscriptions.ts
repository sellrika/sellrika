import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

/**
 * The plan of an account that signed up by itself.
 * One row per owner. No row = the account is free.
 *   trial_ends_at — the free days end here
 *   plan — monthly | yearly, '' = none picked yet
 *   status — Stripe's word for the subscription, '' = never subscribed
 *   cancels — the plan ends at `paid_until` and does not renew
 *   paid_until — the end of the period Stripe has been paid for
 *   stripe_checkout_id — a checkout that was opened and not seen paid yet
 */
export async function up(db: SQL) {
	await db.unsafe(`create table subscriptions (
    id ${ID_PK},
    owner_id integer not null,
    trial_ends_at timestamp not null,
    plan text not null default '',
    status text not null default '',
    cancels boolean not null default false,
    paid_until timestamp,
    stripe_customer_id text,
    stripe_subscription_id text,
    stripe_checkout_id text,
    checkout_at timestamp,
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create unique index idx_subscriptions_owner on subscriptions (owner_id)`,
	);
}
