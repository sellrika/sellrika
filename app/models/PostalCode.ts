/** One GeoNames postal-code line (table `postal_codes`, migration 0044). */
export type PostalCode = {
	id: number;
	country: string;
	postal_code: string;
	place: string;
	admin1: string;
	admin2: string;
};
