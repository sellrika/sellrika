import { Service } from "@xcore/di";
import type { ManualGateway } from "./index";
import { BankTransferGateway } from "./manual/BankTransfer.Gateway";
import { CodGateway } from "./manual/Cod.Gateway";

/**
 * The manual payment options built into the POS.
 * The online providers are extensions instead (`/extensions`).
 */
@Service()
export class GatewayRegistry {
	private readonly gateways: ManualGateway[];

	constructor(cod: CodGateway, bank: BankTransferGateway) {
		this.gateways = [cod, bank];
	}

	/**
	 * Every manual option.
	 * @returns The options, in registration order.
	 */
	all(): ManualGateway[] {
		return this.gateways;
	}

	/**
	 * One option by the key stored in `shops.manual_gateways`.
	 * @param key The option key.
	 * @returns The option, or undefined when the key is empty or no longer exists.
	 */
	get(key: string): ManualGateway | undefined {
		return this.gateways.find((g) => g.key === key);
	}

	/**
	 * The option definitions for the settings UI.
	 * Never credentials.
	 * @returns One `{ key, label, fields }` per option.
	 */
	meta() {
		return this.gateways.map(({ key, label, fields }) => ({
			key,
			label,
			fields,
		}));
	}
}
