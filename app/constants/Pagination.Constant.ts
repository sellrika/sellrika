/** How many rows each paged screen asks for. */

/**
 * Default rows per page.
 * Used when neither the query string nor the `pp_<key>` cookie
 * says otherwise.
 */
export const PER_PAGE = 20;

/**
 * The fewest rows a client-supplied `?per_page=` may ask for
 * (or the cookie the viewport height sets).
 */
export const MIN_PER_PAGE = 5;

/**
 * The most rows a client-supplied `?per_page=` may ask for
 * (or the cookie the viewport height sets).
 */
export const MAX_PER_PAGE = 100;

/**
 * Products per page on the Sell screen.
 * The grid loads the next page when you scroll to the bottom.
 */
export const POS_PER_PAGE = 16;

/**
 * Products per storefront page.
 * Full rows on the templates' 2 / 3 / 4-column grids.
 */
export const STORE_PER_PAGE = 12;

/**
 * Hits per record type in the ⌘K global search
 * (orders, customers, products…).
 */
export const SEARCH_PER_GROUP = 5;
