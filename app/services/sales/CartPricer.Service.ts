import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import type { Key } from "@i18n";
import type { NewItem } from "@repositories/Order.Repository";
import { ProductRepository } from "@repositories/Product.Repository";

type Errors = Record<string, string>;

/**
 * One line of a cart as the client sends it.
 */
export type CartItem = {
	product_id: number;
	variant_id: number | null;
	qty: number;
	choices?: Record<string, number>;
	/**
	 * The buyer's custom request (online store only).
	 */
	note?: string;
};

/**
 * How one checkout wants its cart priced.
 */
export type PricingRules = {
	/**
	 * The message when a line's product is gone.
	 */
	goneKey: Key;
	/**
	 * true = the online store's note rule.
	 * A product that asks for a note must get one.
	 * A note on a product that asks for none is dropped.
	 * false = the till: every note is kept as sent.
	 */
	customRequest: boolean;
};

/**
 * A priced cart, or why it can't be priced.
 */
export type PricedCart =
	| { lines: NewItem[]; subtotal: number; errors?: never }
	| { errors: Errors; lines?: never; subtotal?: never };

/**
 * Turns cart lines into money.
 * The one place both checkouts and both coupon quotes price a cart.
 * Prices, costs and names are read from the DB, never from the client.
 */
@Service()
export class CartPricer {
	constructor(private products: ProductRepository) {}

	/**
	 * Price a cart from the DB.
	 * @param shopId Owning shop.
	 * @param items The raw cart lines.
	 * @param rules The caller's message and note rule.
	 * @returns The priced lines and their subtotal, or `{errors}` (`cart`)
	 *   when a line is gone, unresolved, out of stock or lacks its note.
	 */
	async price(
		shopId: number,
		items: CartItem[],
		rules: PricingRules,
	): Promise<PricedCart> {
		const lines: NewItem[] = [];
		// Lines with different notes stay apart, but they take the same stock.
		// So the units wanted are added up per product and variant.
		// ponytail: a package's parts are checked per line only;
		// the order itself checks them again when it is written.
		const wanted = new Map<string, number>();
		for (const it of CartPricer.mergeItems(items)) {
			const line = await this.products.priceLine(
				it.product_id,
				it.variant_id,
				shopId,
				it.choices,
			);
			if (!line) return { errors: { cart: t(rules.goneKey) } };
			// a package slot the customer never picked
			if ("error" in line) return { errors: { cart: line.error } };
			const unit = `${line.product_id}:${line.variant_id ?? ""}`;
			wanted.set(unit, (wanted.get(unit) ?? 0) + it.qty);
			if (line.track_stock && line.stock < wanted.get(unit)!)
				return {
					errors: { cart: CartPricer.stockMessage(line.name, line.stock) },
				};
			// ponytail: a note on a product that asks for none is dropped
			const note =
				!rules.customRequest || line.custom_request ? (it.note ?? "") : "";
			if (rules.customRequest && line.custom_request && !note)
				return {
					errors: {
						cart: t("store_server.custom_request_missing", {
							name: line.name,
						}),
					},
				};
			lines.push({
				product_id: line.product_id,
				variant_id: line.variant_id,
				name: line.name,
				price: line.price,
				cost: line.cost,
				qty: it.qty,
				track_stock: line.track_stock,
				components: line.components,
				image: line.image,
				note,
			});
		}
		return { lines, subtotal: CartPricer.linesTotal(lines) };
	}

	/**
	 * The out-of-stock message the POS and the storefront both show.
	 * @param name The unit's display name.
	 * @param available How many are left.
	 * @returns A sentence to put in front of the customer.
	 */
	static stockMessage(name: string, available: number) {
		return available > 0
			? t("server.stock_only_left", { count: available, name })
			: t("server.stock_out_of_stock", { name });
	}

	/**
	 * Merge duplicate cart lines so the stock check sees the real quantity.
	 * Two lines are the same with the same product and variant and,
	 * for a package, the same picked options.
	 * Lines with different custom requests stay apart.
	 * @param items The raw cart lines.
	 * @returns One line per distinct unit, quantities summed.
	 */
	static mergeItems(items: CartItem[]) {
		const byKey = new Map<string, CartItem>();
		for (const it of items) {
			const k = CartPricer.mergeKey(it);
			const cur = byKey.get(k);
			if (cur) cur.qty += it.qty;
			else byKey.set(k, { ...it });
		}
		return [...byKey.values()];
	}

	/**
	 * The value of some lines: price times quantity, summed.
	 * @param lines The lines.
	 * @returns The cents.
	 */
	static linesTotal(lines: { price: number; qty: number }[]) {
		let sum = 0;
		for (const l of lines) sum += l.price * l.qty;
		return sum;
	}

	/**
	 * One picked option of a package, as a part of the merge key.
	 * @param choice The slot and the picked variant.
	 * @returns `slot=variant`.
	 */
	private static choiceKey([slot, variant]: [string, number]) {
		return `${slot}=${variant}`;
	}

	/**
	 * What makes two cart lines the same unit.
	 * @param it The cart line.
	 * @returns Product, variant, picked options and note, as one text.
	 */
	private static mergeKey(it: CartItem) {
		const choices = Object.entries(it.choices ?? {})
			.map(CartPricer.choiceKey)
			.sort()
			.join(",");
		return `${it.product_id}:${it.variant_id ?? ""}:${choices}:${it.note ?? ""}`;
	}
}
