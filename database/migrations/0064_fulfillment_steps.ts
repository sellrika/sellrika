import type { SQL } from "bun";

// The delivery steps a shop walks its online orders through, JSON `[{key, label}]` in order.
// '' = the built-in list (new → packing → shipped → delivered). `label` '' = the translated built-in name.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table shops add column fulfillment_steps text not null default ''`,
	);
}
