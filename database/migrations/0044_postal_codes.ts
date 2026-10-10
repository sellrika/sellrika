import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

// Cities and postal codes from GeoNames (https://download.geonames.org/export/zip/), downloaded on
// /online-store › Delivery for the shop's country or for every country — global, not per shop (the
// download status lives in settings, key `postal_codes`). One row per GeoNames line:
//   country     — ISO 3166-1 alpha-2 ("TH")
//   postal_code — as published (some countries only carry a prefix, see the GeoNames readme)
//   place       — the city / locality name the checkout will match city prices against
//   admin1      — state / province name; admin2 — district / county name (may be blank)
export async function up(db: SQL) {
	await db.unsafe(`create table if not exists postal_codes (
    id ${ID_PK},
    country text not null,
    postal_code text not null,
    place text not null,
    admin1 text not null default '',
    admin2 text not null default ''
  )`);
	await db.unsafe(
		`create index if not exists postal_codes_country_place on postal_codes (country, place)`,
	);
	await db.unsafe(
		`create index if not exists postal_codes_country_code on postal_codes (country, postal_code)`,
	);
}
