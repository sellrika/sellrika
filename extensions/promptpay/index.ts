/**
 * PromptPay QR.
 * The server half only hands the customer's screen the shop's PromptPay ID.
 * The QR code is made in the browser. Nothing is sent to a bank or a provider,
 * so nothing tells the app that the money arrived: the shop checks its bank app.
 */
import type { Routes } from "../types";
import { promptpayId } from "./assets/promptpay.ts";

/**
 * Staff routes, served under `/ext/promptpay/…`.
 */
export const routes: Routes = {
	/**
	 * The shop's PromptPay ID as digits, or null when what was typed is not one,
	 * and the two lines to show under the code: the name and the account's
	 * name ("" for none).
	 * None is a secret: the code carries the ID, the bank app shows the name.
	 */
	"GET /config": ({ config }) => ({
		id: promptpayId(String(config.promptpay_id ?? "")),
		name: String(config.display_name ?? "").trim(),
		account: String(config.account_name ?? "").trim(),
	}),
};

/**
 * The event listeners of this extension.
 * There are none: it only draws on the customer's screen.
 */
export default {};
