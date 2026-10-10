import { Service } from "@xcore/di";
import { OwnerRepository } from "@repositories/Owner.Repository";
import { ShopRepository } from "@repositories/Shop.Repository";
import { ProductRepository } from "@repositories/Product.Repository";
import { ReportService } from "@services/sales/Report.Service";
import { PlanLimitService } from "@services/settings/PlanLimit.Service";
import { CAMPAIGN_EMAILS_PER_MONTH } from "@constants/Marketing.Constant";

/**
 * The platform admin's view of the shop owners.
 * Who they are, their shops, and how each shop is doing.
 * Read-only, but for the campaign email limit.
 */
@Service()
export class OwnerService {
	constructor(
		private owners: OwnerRepository,
		private shops: ShopRepository,
		private reports: ReportService,
		private products: ProductRepository,
		private limits: PlanLimitService,
	) {}

	/**
	 * One page of shop owners.
	 * @param q Search text over name and email.
	 * @param page Page number, from 1.
	 * @param perPage Rows per page.
	 * @returns The page.
	 */
	list(q: string, page: number, perPage: number) {
		return this.owners.page(q, page, perPage);
	}

	/**
	 * One owner with their shops and staff.
	 * @param id The owner's user id.
	 * @returns The owner, shops, staff and this month's campaign emails.
	 * Null when there is no such owner.
	 */
	async show(id: number) {
		const owner = await this.owners.find(id);
		if (!owner) return null;
		const [shops, staff, campaign_emails, own] = await Promise.all([
			this.owners.shops(id),
			this.owners.staff(id),
			this.limits.campaignEmails(id),
			this.owners.campaignLimit(id),
		]);
		return {
			owner,
			shops,
			staff,
			campaign_emails: {
				...campaign_emails,
				own,
				default: CAMPAIGN_EMAILS_PER_MONTH,
			},
		};
	}

	/**
	 * Set an owner's monthly campaign email limit.
	 * @param id The owner's user id.
	 * @param limit The limit, or null = the default.
	 * @returns False when there is no such owner.
	 */
	setCampaignLimit(id: number, limit: number | null) {
		return this.owners.setCampaignLimit(id, limit);
	}

	/**
	 * One shop of an owner: its settings and its all-time totals.
	 * And the report for a period.
	 * These are the same numbers as the shop's own /reports page.
	 * @param ownerId The owner.
	 * @param shopId The shop.
	 * @param sp The query string (`?preset=&from=&to=`, like /reports).
	 * @returns The owner, the shop, its totals and its report.
	 * Null when the shop is not theirs.
	 */
	async shop(ownerId: number, shopId: number, sp: URLSearchParams) {
		const found = await this.#ownedShop(ownerId, shopId);
		if (!found) return null;
		const { owner, shop } = found;
		const [totals, report] = await Promise.all([
			this.owners.totals(shop.id),
			this.reports.build(
				shop.id,
				shop.timezone,
				ReportService.resolveQuery(sp, shop.timezone),
			),
		]);
		return {
			owner,
			shop,
			totals,
			report: {
				query: report.query,
				summary: report.summary,
				previous: report.previous,
				series: report.series,
				top_products: report.top_products,
				by_method: report.by_method,
			},
		};
	}

	/**
	 * One page of a shop's products.
	 * The same list the shop sees on its own /products page.
	 * @param ownerId The owner.
	 * @param shopId The shop.
	 * @param q Search text over name, SKU and barcode.
	 * @param page Page number, from 1.
	 * @param perPage Rows per page.
	 * @returns The owner, the shop and the page, or null when the shop is not theirs.
	 */
	async shopProducts(
		ownerId: number,
		shopId: number,
		q: string,
		page: number,
		perPage: number,
	) {
		const found = await this.#ownedShop(ownerId, shopId);
		if (!found) return null;
		const { owner, shop } = found;
		return {
			owner,
			shop,
			products: await this.products.pageForShop(shop.id, q, page, perPage),
		};
	}

	/**
	 * An owner and one of their shops.
	 * @param ownerId The owner.
	 * @param shopId The shop.
	 * @returns Both, or null when the shop is not theirs.
	 */
	async #ownedShop(ownerId: number, shopId: number) {
		const [owner, shop] = await Promise.all([
			this.owners.find(ownerId),
			this.shops.findOwned(shopId, ownerId),
		]);
		return owner && shop ? { owner, shop } : null;
	}
}
