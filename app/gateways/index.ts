/**
 * A field the merchant fills in for a manual payment option.
 * It is on /online-store › Payments.
 * A `secret: true` field is stored encrypted (app/helpers/crypto.ts).
 * It is never sent back to the page.
 */
export type GatewayField = {
	name: string;
	label: string;
	secret: boolean;
	placeholder?: string;
	multiline?: boolean;
};

/**
 * A manual payment option (cash on delivery, bank transfer).
 * There is no provider at all.
 * So the order is created **unpaid** the moment the buyer places it.
 * The shop records the money on /orders/:id when it arrives.
 * Several can be switched on next to the online gateway
 * (`shops.manual_gateways`).
 * `fields` holds what the buyer is told (bank details), never a secret.
 * `instructions` names the field shown to the buyer, if any.
 * The online gateways are extensions, not these.
 * See `ExtensionService.payments()`.
 */
export type ManualGateway = {
	key: string;
	label: string;
	fields: GatewayField[];
	instructions?: string;
};
