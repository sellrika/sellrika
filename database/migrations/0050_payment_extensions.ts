import type { SQL } from "bun";

// The online payment providers (stripe, omise, 2c2p, paypal) became extensions: the admin uploads a zip and
// `shop_extensions` holds its switch and its keys. The manual options (cod, bank_transfer) stay built in, so
// `shops.manual_gateways` and `shops.payment_credentials` stay too — the latter now holds only their fields.
// This moves what each shop already saved: one `shop_extensions` row per provider, enabled when it was the
// shop's `payment_gateway`. The secrets inside are already encrypted with the same APP_KEY the extensions
// read, so they move as they are. The row waits for the matching zip — nothing runs until the admin uploads
// it, and the upload keeps these saved keys.
const PROVIDERS = ["stripe", "omise", "2c2p", "paypal"];

export async function up(db: SQL) {
	const shops: {
		id: number;
		payment_gateway: string;
		payment_credentials: string | null;
	}[] = await db.unsafe(
		`select id, payment_gateway, payment_credentials from shops`,
	);
	for (const s of shops) {
		let creds: Record<string, Record<string, unknown>> = {};
		try {
			creds = JSON.parse(s.payment_credentials || "{}") || {};
		} catch {
			creds = {}; // unreadable JSON: nothing to move, the admin re-enters the keys
		}
		for (const key of PROVIDERS) {
			if (!creds[key] && s.payment_gateway !== key) continue;
			await db`insert into shop_extensions (shop_id, key, enabled, config) values (${s.id}, ${key}, ${s.payment_gateway === key}, ${JSON.stringify(creds[key] ?? {})})
        on conflict (shop_id, key) do nothing`;
			delete creds[key];
		}
		await db`update shops set payment_credentials = ${JSON.stringify(creds)} where id = ${s.id}`;
	}
	await db.unsafe(`alter table shops drop column payment_gateway`);
}
