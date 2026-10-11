import { Service } from "@xcore/di";
import type { SQL } from "bun";
import { type Fragment, sql } from "@xcore/database/Database";
import type { PostalCode } from "@models/PostalCode";
import { CITY_PAGE } from "@constants/Postal.Constant";

/**
 * The two name columns the zone dialog suggests from.
 * Fixed SQL only, never the request's text.
 * `only` leaves out rows where the column is empty.
 */
const SUGGEST = {
	admin1: { column: sql`admin1`, only: sql`admin1 <> '' and` },
	place: { column: sql`place`, only: sql`` },
};

/**
 * The GeoNames cities / postal codes.
 * Global: every shop reads the same list.
 */
@Service()
export class PostalCodeRepository {
	/**
	 * Drop what a download is about to replace.
	 * @param country ISO code to clear, or null for the whole table.
	 */
	async clear(country: string | null) {
		await sql`delete from postal_codes ${this.#ofCountry(country)}`;
	}

	/**
	 * Insert one batch in its own transaction.
	 * Short ones keep the rest of the app served during a big import.
	 * @param rows Parsed lines.
	 * @returns A promise that ends when the batch is written.
	 */
	insert(rows: Omit<PostalCode, "id">[]) {
		if (!rows.length) return Promise.resolve();
		return sql.begin((tx) => this.#write(tx, rows));
	}

	/**
	 * How many lines are stored.
	 * @param country ISO code, or null for everything.
	 * @returns The count.
	 */
	async count(country: string | null = null): Promise<number> {
		const [r] =
			await sql`select count(*) as n from postal_codes ${this.#ofCountry(country)}`;
		return Number(r.n);
	}

	/**
	 * Which countries are in the table and how many lines each has.
	 * @returns One row per country.
	 */
	countries(): Promise<{ country: string; rows: number }[]> {
		return sql`select country, count(*) as "rows" from postal_codes group by country`;
	}

	/**
	 * States / provinces (GeoNames admin1) of a country, A–Z.
	 * Empty when the country isn't downloaded (or has none).
	 * @param country ISO code.
	 * @returns The names.
	 */
	async states(country: string): Promise<string[]> {
		const rows: { admin1: string }[] =
			await sql`select distinct admin1 from postal_codes where country = ${country} and admin1 <> '' order by admin1`;
		return rows.map((r) => r.admin1);
	}

	/**
	 * The places of a state, A–Z, one row each with a postal code.
	 * A place with several codes gives the lowest.
	 * Only the first `limit` of those containing `q` (any case) come back.
	 * `more` says whether there are more.
	 * The box then asks again as the buyer types.
	 * @param country ISO code.
	 * @param state The admin1 name as `states()` gave it.
	 * @param q What was typed ("" = the start of the list).
	 * @param limit Rows at most.
	 * @returns The places, and whether there are more.
	 */
	async cities(
		country: string,
		state: string,
		q = "",
		limit = CITY_PAGE,
	): Promise<{
		cities: { place: string; postal_code: string }[];
		more: boolean;
	}> {
		const rows: { place: string; postal_code: string }[] =
			await sql`select place, min(postal_code) as postal_code from postal_codes
      where country = ${country} and admin1 = ${state} and lower(place) like ${`%${q.trim().toLowerCase()}%`} group by place order by place limit ${limit + 1}`;
		return { cities: rows.slice(0, limit), more: rows.length > limit };
	}

	/**
	 * The place name(s) a postal code stands for, A–Z.
	 * A code can cover several places. [] when unknown.
	 * @param country ISO code.
	 * @param postalCode As typed. Surrounding spaces are ignored.
	 *   Case is kept as GeoNames has it: codes are digits or upper-case.
	 * @returns The place names.
	 */
	async placesOf(country: string, postalCode: string): Promise<string[]> {
		const code = postalCode.trim().toUpperCase();
		if (!code) return [];
		const rows: { place: string }[] =
			await sql`select distinct place from postal_codes where country = ${country} and upper(postal_code) = ${code} order by place`;
		return rows.map((r) => r.place);
	}

	/**
	 * Distinct state / province names (admin1) for a zone's States chips.
	 * Names that start with `q` come first, then names that contain it.
	 * @param countries ISO codes to look in; [] = every downloaded country.
	 * @param q What was typed (any case).
	 * @param limit Rows at most.
	 * @returns The names, and whether there are more.
	 */
	async regions(
		countries: string[],
		q: string,
		limit = CITY_PAGE,
	): Promise<{ places: string[]; more: boolean }> {
		return this.#suggest("admin1", countries, q, limit);
	}

	/**
	 * Distinct place names for a zone's Cities chips.
	 * Names that start with `q` come first, then names that contain it.
	 * Only the first `limit` come back ("" = the start of the A–Z list).
	 * @param countries ISO codes to look in; [] = every downloaded country.
	 * @param q What was typed (any case).
	 * @param limit Rows at most.
	 * @returns The names, and whether there are more.
	 */
	async places(
		countries: string[],
		q: string,
		limit = CITY_PAGE,
	): Promise<{ places: string[]; more: boolean }> {
		return this.#suggest("place", countries, q, limit);
	}
	/**
	 * The `where` of one country, or nothing for the whole table.
	 * @param country ISO code, or null for everything.
	 * @returns The SQL fragment.
	 */
	#ofCountry(country: string | null): Fragment {
		return country === null ? sql`` : sql`where country = ${country}`;
	}

	/**
	 * The write of `insert`, inside its transaction.
	 * @param tx The open transaction.
	 * @param rows Parsed lines.
	 */
	async #write(tx: SQL, rows: Omit<PostalCode, "id">[]) {
		await tx`insert into postal_codes ${tx(rows)}`;
	}

	/**
	 * The query `regions` and `places` share.
	 * @param name Which name column to suggest from.
	 * @param countries ISO codes to look in; [] = every downloaded country.
	 * @param q What was typed (any case).
	 * @param limit Rows at most.
	 * @returns The names, and whether there are more.
	 */
	async #suggest(
		name: keyof typeof SUGGEST,
		countries: string[],
		q: string,
		limit: number,
	): Promise<{ places: string[]; more: boolean }> {
		const { column, only } = SUGGEST[name];
		const term = q.trim().toLowerCase();
		const rows: Record<string, string>[] =
			await sql`select distinct ${column} from postal_codes where ${only} lower(${column}) like ${`%${term}%`} ${countries.length ? sql`and country in ${sql(countries)}` : sql``}
      order by case when lower(${column}) like ${`${term}%`} then 0 else 1 end, ${column} limit ${limit + 1}`;
		return {
			places: rows.slice(0, limit).map((r) => r[name] as string),
			more: rows.length > limit,
		};
	}
}
