import { ShopRepository } from "@repositories/Shop.Repository";
import { PlanLimitService } from "@services/settings/PlanLimit.Service";
import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { dayRange } from "@helpers/time";
import { SalesStaffRepository } from "@repositories/SalesStaff.Repository";
import type { SalesStaffInput } from "@validators/SalesStaff.Validator";
import type { Errors } from "@validators/validate";

/**
 * Sales staff: the people named on a sale.
 * They never sign in.
 */
@Service()
export class SalesStaffService {
	constructor(
		private staff: SalesStaffRepository,
		private shops: ShopRepository,
		private limits: PlanLimitService,
	) {}

	/**
	 * Every sales person of a shop, for the Staff page.
	 * @param shopId Owning shop.
	 * @returns The sales staff, A–Z.
	 * Each with their `orders` count and the commission `due`.
	 */
	list(shopId: number) {
		return this.staff.all(shopId);
	}

	/**
	 * The sales staff as a pick list: id and name only.
	 * The POS offers the active ones; the Orders filter offers everyone.
	 * @param shopId Owning shop.
	 * @param activeOnly True = leave out the ones switched off.
	 * @returns Id and name, A–Z.
	 */
	async options(shopId: number, activeOnly = false) {
		const all = await this.staff.all(shopId);
		return all
			.filter(function wanted(s) {
				return s.active || !activeOnly;
			})
			.map(function pick(s) {
				return { id: s.id, name: s.name };
			});
	}

	/**
	 * One sales person's page.
	 * Who they are, what they sold in a period, and what they were paid.
	 * The period's commission is its sales at today's rate.
	 * It is not what is due:
	 * `person.due` counts the sales since the last payment, whatever the period.
	 * @param id Their id.
	 * @param shopId Owning shop.
	 * @param tz The shop's timezone.
	 * The period's days are the shop's days.
	 * @param period The first and last day, `YYYY-MM-DD`.
	 * @returns The page's data, or null when they are not in this shop.
	 */
	async detail(
		id: number,
		shopId: number,
		tz: string,
		period: { from: string; to: string },
	) {
		const person = await this.staff.find(id, shopId);
		if (!person) return null;
		const totals = await this.staff.totals(
			id,
			dayRange(tz, period.from, period.to),
		);
		const payments = await this.staff.payments(shopId);
		return {
			person,
			totals: {
				...totals,
				commission: Math.round((totals.sold * person.commission) / 10000),
			},
			payments: payments.filter(function theirs(p) {
				return p.sales_staff_id === id;
			}),
		};
	}

	/**
	 * Add a sales person to a shop.
	 * @param shopId Owning shop.
	 * @param d Validated name, commission and active switch.
	 * @returns `{staff}` = the new sales person,
	 *   or `{errors}` when the plan's limit is reached (`PlanLimitService`).
	 */
	async create(shopId: number, d: SalesStaffInput) {
		const shop = await this.shops.find(shopId);
		const full =
			shop &&
			(await this.limits.freeError(
				shop.owner_id,
				"salesStaff",
				(
					await this.staff.all(shopId)
				).length,
			));
		if (full) return { errors: { name: full } };
		return {
			staff: await this.staff.find(await this.staff.create(shopId, d), shopId),
		};
	}

	/**
	 * One sales person of a shop.
	 * @param id Their id.
	 * @param shopId Owning shop.
	 * @returns The sales person with what is due to them, or null.
	 */
	find(id: number, shopId: number) {
		return this.staff.find(id, shopId);
	}

	/**
	 * Change a sales person of a shop.
	 * A new commission counts for every sale that is not paid yet.
	 * @param id Their id.
	 * @param shopId Owning shop.
	 * @param d Validated name, commission and active switch.
	 * @returns Inertia errors, or null on success.
	 */
	async update(
		id: number,
		shopId: number,
		d: SalesStaffInput,
	): Promise<Errors | null> {
		if (!(await this.staff.find(id, shopId)))
			return { sales: t("server.sales_staff_not_found") };
		await this.staff.update(id, d);
		return null;
	}

	/**
	 * Pay a sales person's commission.
	 * The amount is worked out now, from the sales since the last payment.
	 * It is saved to the history.
	 * The newest payment is where the next commission starts.
	 * @param id Their id.
	 * @param shopId Owning shop.
	 * @returns Inertia errors, or null on success.
	 */
	async pay(id: number, shopId: number): Promise<Errors | null> {
		const target = await this.staff.find(id, shopId);
		if (!target) return { sales: t("server.sales_staff_not_found") };
		if (!target.due) return { sales: t("server.sales_staff_nothing_due") };
		await this.staff.pay(target);
		return null;
	}

	/**
	 * Delete a sales person of a shop, with their payment history.
	 * Their sales stay, with nobody named on them any more.
	 * @param id Their id.
	 * @param shopId Owning shop.
	 * @returns Inertia errors, or null on success.
	 */
	async remove(id: number, shopId: number): Promise<Errors | null> {
		if (!(await this.staff.find(id, shopId)))
			return { sales: t("server.sales_staff_not_found") };
		await this.staff.delete(id);
		return null;
	}
}
