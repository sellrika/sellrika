import { z } from "zod";
import { ROLES } from "@constants/User.Constant";

/** A new key's name and the most it may do. POST /api-keys. */
export const ApiKeyInput = z.object({
	/** A name to tell the key apart. Needed, at most 100 characters. */
	name: z.string().trim().min(1, "validation.name_required").max(100),
	/**
	 * The most the key may do:
	 * `admin`, `manager` or `cashier`.
	 */
	role: z.enum(ROLES, { message: "validation.pick_a_role" }),
});
/** A checked `ApiKeyInput`. */
export type ApiKeyInput = z.infer<typeof ApiKeyInput>;
