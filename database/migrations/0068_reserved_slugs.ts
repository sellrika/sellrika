import type { SQL } from "bun";
import { RESERVED_SLUGS } from "@constants/Store.Constant";

/**
 * Every shop's slug is now its subdomain (`<slug>.shop.sellrika.com`).
 * A shop that already had a reserved one ("mail", "pos") gets `-shop` added,
 * unless another shop has that already (then it keeps its slug; boot must not fail).
 */
export async function up(db: SQL) {
	for (const slug of RESERVED_SLUGS) {
		const next = `${slug}-shop`;
		await db`update shops set slug = ${next} where slug = ${slug}
			and not exists (select 1 from (select slug from shops) s where s.slug = ${next})`;
	}
}
