import type { ListSort } from "@xcore/http/Paginate";

/** The columns the customer list can be sorted by (`/customers?sort=&dir=`). */
export const CUSTOMER_SORTS = [
	"name",
	"email",
	"orders",
	"spent",
	"last_order",
] as const;

/** A sort of the customer list: the column and the direction. */
export type CustomerSort = ListSort<(typeof CUSTOMER_SORTS)[number]>;
