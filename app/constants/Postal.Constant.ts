/**
 * The GeoNames base URLs live in config/app.ts (`app.geonames`).
 * The env can override them, for the e2e fixtures.
 */

/**
 * The file with the names of the admin1 codes the place dump uses
 * (`MM.17` → "Yangon").
 * It sits next to the place-name dumps.
 */
export const GEONAMES_ADMIN1 = "admin1CodesASCII.txt";

/** The file for "every country". */
export const GEONAMES_ALL = "allCountries";

/**
 * `settings` key holding the last download's outcome
 * (scope, rows, when, error).
 */
export const POSTAL_SETTING_KEY = "postal_codes";

/**
 * Rows per insert statement (one transaction each) while importing.
 * 5 columns → 25,000 parameters, under SQLite's 32,766 cap.
 * Bigger batches mean fewer commits (the cost).
 * The import still yields between them.
 */
export const POSTAL_BATCH = 5000;

/**
 * A run with no progress for this long is given up as stalled.
 * The page shows why, and a new run may start.
 */
export const POSTAL_STALL_MS = 5 * 60_000;

/** What an admin may ask to download. */
export const POSTAL_SCOPES = ["country", "all"] as const;

/** One of `POSTAL_SCOPES`. */
export type PostalScope = (typeof POSTAL_SCOPES)[number];

/**
 * Cities a city box loads at once (A–Z).
 * A state can hold hundreds.
 * So past this the server searches what is typed
 * (checkout City list, a zone's Cities chips).
 */
export const CITY_PAGE = 20;
