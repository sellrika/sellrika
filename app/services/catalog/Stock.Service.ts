import type { SQL } from "bun";
import { sql } from "@xcore/database/Database";
import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import { StockRepository } from "@repositories/Stock.Repository";
import type { StockAdjustInput } from "@validators/Stock.Validator";
import type { Errors } from "@validators/validate";
import { ADJUST_REASON_LABEL } from "@constants/Stock.Constant";

/**
 * The /stock screen: read the ledger, and write to it by hand.
 */
@Service()
export class StockService {
	constructor(
		private stock: StockRepository,
		private extensions: ExtensionService,
	) {}

	/**
	 * One page of tracked units.
	 * @param shopId Owning shop.
	 * @param filter all | low | out.
	 * @param q Matches product/variant name or barcode.
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of stock units.
	 */
	page(
		shopId: number,
		filter: "all" | "low" | "out",
		q: string,
		page: number,
		perPage: number,
	) {
		return this.stock.pageForShop(shopId, filter, q, page, perPage);
	}

	/**
	 * Counts for the page header and the reports.
	 * @param shopId Owning shop.
	 * @returns Tracked / low / out counts.
	 */
	summary(shopId: number) {
		return this.stock.summary(shopId);
	}

	/**
	 * Movement history of one unit.
	 * @param shopId Owning shop.
	 * @param productId Product id.
	 * @param variantId Variant id, or null for the product itself.
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of movements, newest first.
	 */
	movements(
		shopId: number,
		productId: number,
		variantId: number | null,
		page: number,
		perPage: number,
	) {
		return this.stock.movements(shopId, productId, variantId, page, perPage);
	}

	/**
	 * How many of one unit are on hand.
	 * @param shopId Owning shop.
	 * @param productId Product id.
	 * @param variantId Variant id, or null for the product itself.
	 * @returns The count, or null when the unit is not in this shop.
	 */
	level(shopId: number, productId: number, variantId: number | null) {
		return this.stock.level(sql, shopId, productId, variantId);
	}

	/**
	 * Manual adjustment (+/− or "set to").
	 * It is written through the ledger inside one transaction.
	 * @param shopId Owning shop.
	 * @param userId Who is adjusting. Credited on the movement.
	 * @param d Validated unit, reason, note and either `delta` or `set`.
	 * @returns Inertia errors, or null on success.
	 * A no-op delta also counts as success.
	 */
	async adjust(
		shopId: number,
		userId: number,
		d: StockAdjustInput,
	): Promise<Errors | null> {
		const stockMark = await this.extensions.stockMark(shopId);
		const errors = await sql.begin((tx) =>
			this.#adjustIn(tx, shopId, userId, d),
		);
		if (!errors)
			void this.extensions.stockMoved(shopId, stockMark, {
				productId: d.product_id,
				variantId: d.variant_id,
			});
		return errors;
	}

	/**
	 * The work of `adjust`, inside its transaction.
	 * The level is read and the movement written in the same transaction.
	 * @param tx The transaction.
	 * @param shopId Owning shop.
	 * @param userId Who is adjusting.
	 * @param d Validated unit, reason, note and either `delta` or `set`.
	 * @returns Inertia errors, or null on success.
	 */
	async #adjustIn(
		tx: SQL,
		shopId: number,
		userId: number,
		d: StockAdjustInput,
	): Promise<Errors | null> {
		const current = await this.stock.level(
			tx,
			shopId,
			d.product_id,
			d.variant_id,
		);
		if (current === null)
			return { product_id: t("server.stock_item_not_found") };
		const delta = d.set !== null ? d.set - current : d.delta!;
		if (delta === 0) return null;
		if (current + delta < 0)
			return { delta: t("server.stock_only_in_stock", { count: current }) };
		const label = t(ADJUST_REASON_LABEL[d.reason]);
		const reason = d.note
			? t("server.stock_reason_note", { reason: label, note: d.note })
			: label;
		const ok = await this.stock.move(tx, {
			shopId,
			productId: d.product_id,
			variantId: d.variant_id,
			type: "adjustment",
			qty: delta,
			reason,
			userId,
		});
		return ok ? null : { product_id: t("server.stock_not_tracked") };
	}
}
