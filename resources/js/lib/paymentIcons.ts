import type { Component } from "vue";
import {
	Banknote,
	CreditCard,
	Wallet,
	Smartphone,
	QrCode,
	Landmark,
	Coins,
	PiggyBank,
	Gift,
	Ticket,
	Receipt,
	HandCoins,
	BadgeDollarSign,
	CircleDollarSign,
	Bitcoin,
	Nfc,
	Wifi,
	Globe,
	Building2,
	Store,
	ShoppingBag,
	Percent,
	Tag,
	Star,
	Heart,
} from "@lucide/vue";
import {
	PAYMENT_ICON_NAMES,
	type PaymentIconName,
} from "@constants/PaymentMethod.Constant";

/** Name → lucide component for the 25 payment-method icons (same list the server validates against). */
export const PAYMENT_ICONS: Record<PaymentIconName, Component> = {
	Banknote,
	CreditCard,
	Wallet,
	Smartphone,
	QrCode,
	Landmark,
	Coins,
	PiggyBank,
	Gift,
	Ticket,
	Receipt,
	HandCoins,
	BadgeDollarSign,
	CircleDollarSign,
	Bitcoin,
	Nfc,
	Wifi,
	Globe,
	Building2,
	Store,
	ShoppingBag,
	Percent,
	Tag,
	Star,
	Heart,
};
export { PAYMENT_ICON_NAMES };
export const paymentIcon = (name: string | null | undefined): Component =>
	PAYMENT_ICONS[name as PaymentIconName] ?? Wallet;

/** Badge styling from a method's color (10% tint background, colored text/border); undefined → plain outline. */
export const methodStyle = (color: string | null | undefined) =>
	color
		? { color, borderColor: color, backgroundColor: `${color}1a` }
		: undefined;
