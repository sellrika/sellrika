/** One way to pay in a shop, as the `payment_methods` table keeps it. */
export type PaymentMethod = {
	id: number;
	shop_id: number;
	name: string;
	icon: string;
	color: string | null;
	/**
	 * A picture for the customer's screen (a QR code to pay).
	 * An `/uploads/…` path.
	 */
	image: string | null;
	/**
	 * The key of the extension that added the method
	 * (manifest `payment_method`). null = the shop's own.
	 */
	extension: string | null;
	tendered: boolean;
	enabled: boolean;
	position: number;
};
