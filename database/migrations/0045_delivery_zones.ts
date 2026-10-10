import type { SQL } from "bun";

// Shipping zones (Shopify-style) replace the flat domestic / international prices of 0030 and the city rates of 0043:
//   shops.delivery_zones  — JSON [{ name, countries: string[], states: string[], cities: string[], fee, free_delivery_min }]
//                           countries [] = every country no other zone lists ("rest of world"); states / cities [] = the whole country
//                           (the one pricing rule is deliveryFee() in app/validators/StoreCustomer.Validator.ts)
//   shops.guided_address  — the checkout offers State → City lists when the country's postal codes are downloaded;
//                           off = plain text boxes (for countries whose GeoNames records are poor, e.g. Myanmar)
// What a shop had set is carried over: one zone per city-price row, one for the shop's country (the domestic price),
// and a rest-of-world zone when an international price was set. The old columns go.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table shops add column delivery_zones text not null default '[{"name":"Everywhere","countries":[],"states":[],"cities":[],"fee":0,"free_delivery_min":null}]'`,
	);
	await db.unsafe(
		`alter table shops add column guided_address boolean not null default true`,
	);
	const shops: {
		id: number;
		country: string | null;
		delivery_fee: number | null;
		delivery_fee_abroad: number | null;
		free_delivery_min: number | null;
		delivery_rates: string | null;
	}[] = await db.unsafe(
		`select id, country, delivery_fee, delivery_fee_abroad, free_delivery_min, delivery_rates from shops`,
	);
	for (const s of shops) {
		const home = s.country ? [s.country] : [];
		const rates: { cities: string[]; fee: number }[] = JSON.parse(
			s.delivery_rates || "[]",
		).map((r: { city?: string; cities?: string[]; fee: number }) =>
			r.cities ? r : { cities: [r.city], fee: r.fee },
		);
		const zones = [
			...rates.map((r) => ({
				name: r.cities.join(", "),
				countries: home,
				states: [],
				cities: r.cities,
				fee: r.fee,
				free_delivery_min: s.free_delivery_min ?? null,
			})),
			{
				name: s.country ?? "Everywhere",
				countries: home,
				states: [],
				cities: [],
				fee: s.delivery_fee ?? 0,
				free_delivery_min: s.free_delivery_min ?? null,
			},
			...(s.country && s.delivery_fee_abroad != null
				? [
						{
							name: "Rest of world",
							countries: [],
							states: [],
							cities: [],
							fee: s.delivery_fee_abroad,
							free_delivery_min: null,
						},
					]
				: []),
		];
		await db`update shops set delivery_zones = ${JSON.stringify(zones)} where id = ${s.id}`;
	}
	for (const col of [
		"delivery_fee",
		"delivery_fee_abroad",
		"free_delivery_min",
		"delivery_rates",
	])
		await db.unsafe(`alter table shops drop column ${col}`);
}
