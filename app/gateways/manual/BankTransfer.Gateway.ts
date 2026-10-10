import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import type { GatewayField, ManualGateway } from "@gateways/index";

/**
 * Bank transfer.
 * The buyer is shown the shop's bank details and pays on their own.
 * The shop records it on the order.
 */
@Service()
export class BankTransferGateway implements ManualGateway {
	readonly key = "bank_transfer";
	readonly instructions = "instructions";

	/**
	 * The option's name, translated per request.
	 * @returns "Bank transfer".
	 */
	get label() {
		return t("server.gateway_bank_transfer");
	}

	/**
	 * What the merchant fills in.
	 * A getter, not a field: the labels are translated per request.
	 * @returns The bank details field.
	 */
	get fields(): GatewayField[] {
		return [
			{
				name: "instructions",
				label: t("server.gateway_bank_details"),
				secret: false,
				multiline: true,
				placeholder: t("server.gateway_bank_placeholder"),
			},
		];
	}
}
