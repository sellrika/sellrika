import type { SQL } from "bun";

/**
 * Where a shop's custom domain stands (`shops.domain_status`):
 *   '' = no domain, or nobody manages it (DOMAIN_CNAME not set)
 *   pending = waiting for the DNS to point here
 *   live = routed by the proxy, with an SSL certificate
 * Domains saved before this start as pending; the next check makes them live.
 */
export async function up(db: SQL) {
	await db.unsafe(
		`alter table shops add column domain_status text not null default ''`,
	);
	await db.unsafe(
		`update shops set domain_status = 'pending' where domain is not null`,
	);
}
