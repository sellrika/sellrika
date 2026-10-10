import { z } from "zod";
import { personName } from "@validators/Fields.Validator";

/**
 * A sales person's name, commission and active switch.
 * POST /sales-staff and PUT /sales-staff/:id.
 * The REST API uses it too (`/api/v1/sales-staff`).
 */
export const SalesStaffInput = z.object({
	/** The sales person's name. Needed, at most 100 characters. */
	name: personName,
	/**
	 * The commission rate.
	 * In hundredths of a percent: 250 = 2.5%.
	 * 0 to 10000. Left out = 0.
	 */
	commission: z
		.number("validation.commission_range")
		.int("validation.commission_range")
		.min(0, "validation.commission_range")
		.max(10000, "validation.commission_range")
		.default(0),
	/** False = switched off. Their history is kept. */
	active: z.boolean().default(true),
});
/** A checked `SalesStaffInput`. */
export type SalesStaffInput = z.infer<typeof SalesStaffInput>;
