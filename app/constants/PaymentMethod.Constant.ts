/**
 * The 25 lucide icons a payment method may use.
 * Stored by export name.
 * The UI map is in resources/js/lib/paymentIcons.ts.
 */
export const PAYMENT_ICON_NAMES = [
	"Banknote",
	"CreditCard",
	"Wallet",
	"Smartphone",
	"QrCode",
	"Landmark",
	"Coins",
	"PiggyBank",
	"Gift",
	"Ticket",
	"Receipt",
	"HandCoins",
	"BadgeDollarSign",
	"CircleDollarSign",
	"Bitcoin",
	"Nfc",
	"Wifi",
	"Globe",
	"Building2",
	"Store",
	"ShoppingBag",
	"Percent",
	"Tag",
	"Star",
	"Heart",
] as const;

/** One of `PAYMENT_ICON_NAMES`. */
export type PaymentIconName = (typeof PAYMENT_ICON_NAMES)[number];
