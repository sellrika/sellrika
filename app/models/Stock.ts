/** Why a unit's stock changed. */
export type StockMovementType = "sale" | "refund" | "void" | "adjustment";
/** One row of the stock ledger (`stock_movements`). */
export type StockMovement = {
	id: number;
	shop_id: number;
	product_id: number;
	variant_id: number | null;
	type: StockMovementType;
	/** Signed: + in, − out. */
	qty: number;
	reason: string;
	order_id: number | null;
	user_id: number | null;
	created_at: string;
};
/**
 * A unit as an extension sees it on `stock.updated`.
 * The names, the count after the move and the product's "low" line.
 */
export type StockUnit = {
	name: string;
	variant: string | null;
	stock: number;
	low_stock_at: number;
};
/**
 * One tracked unit as listed on the Stock page.
 * A product without variants, or one variant.
 */
export type StockItem = {
	product_id: number;
	variant_id: number | null;
	name: string;
	variant_name: string | null;
	image: string | null;
	barcode: string | null;
	stock: number;
	low_stock_at: number;
};
