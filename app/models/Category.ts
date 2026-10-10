export type Category = {
	id: number;
	shop_id: number;
	name: string;
	position: number;
	color: string | null;
	/** An `/uploads/…` picture, null = none. */
	image: string | null;
};
