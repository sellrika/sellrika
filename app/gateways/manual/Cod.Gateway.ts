import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import type { ManualGateway } from "@gateways/index";

/**
 * Cash on delivery: nothing to set up.
 * The buyer pays the courier, the shop records it on the order.
 */
@Service()
export class CodGateway implements ManualGateway {
	readonly key = "cod";
	readonly fields = [];
	/**
	 * The option's name, translated per request.
	 * @returns "Cash on delivery".
	 */
	get label() {
		return t("server.gateway_cod");
	}
}
