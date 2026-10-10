/**
 * The user guide: help texts for the people who use the app.
 * One topic = one file, `resources/guide/<topic>.md`.
 * A new topic is a new name here, a new file,
 * and a new line in `resources/guide/index.ts`.
 */
export const GUIDE_TOPICS = [
	"overview",
	"selling",
	"orders",
	"customers",
	"coupons",
	"marketing",
	"reports",
	"products",
	"stock",
	"online-store",
	"store-checkout",
	"staff",
	"settings",
] as const;

/** One of `GUIDE_TOPICS`. */
export type GuideTopic = (typeof GUIDE_TOPICS)[number];

/**
 * The topic a call without `?topic=` gets.
 * It says what the app is and names the other topics.
 */
export const GUIDE_DEFAULT: GuideTopic = "overview";
