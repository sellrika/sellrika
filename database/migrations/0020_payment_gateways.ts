import type { SQL } from "bun";

// Generic payment gateways (Stripe today; Omise/PayPal/… later, see app/gateways/index.ts):
// shops.payment_gateway picks the provider, shops.payment_credentials holds a JSON object
// { [gatewayKey]: { field: value } } — secret fields are individually encrypted strings
// (app/xcore/crypto.ts), so this migration can move the already-encrypted Stripe key verbatim
// without needing APP_KEY. The stripe_* columns from 0018 are folded in and dropped.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table shops add column payment_gateway text not null default 'stripe'`,
	);
	await db.unsafe(`alter table shops add column payment_credentials text`);
	const shops: {
		id: number;
		stripe_publishable_key: string | null;
		stripe_secret_key: string | null;
	}[] = await db.unsafe(
		`select id, stripe_publishable_key, stripe_secret_key from shops`,
	);
	for (const s of shops) {
		if (!s.stripe_publishable_key && !s.stripe_secret_key) continue;
		const creds = {
			stripe: {
				publishable_key: s.stripe_publishable_key ?? "",
				secret_key: s.stripe_secret_key ?? "",
			},
		};
		await db`update shops set payment_credentials = ${JSON.stringify(creds)} where id = ${s.id}`;
	}
	await db.unsafe(`alter table shops drop column stripe_publishable_key`);
	await db.unsafe(`alter table shops drop column stripe_secret_key`);
}
