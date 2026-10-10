/**
 * A counter per shop that goes up each time its products change.
 * The online store keeps a shop's public catalog in memory.
 * It compares this number to know its copy is still good.
 * It lives here, free of imports, so repositories can bump it
 * without importing a service.
 */
const versions = new Map<number, number>();

/**
 * The shop's catalog counter as it stands now.
 * @param shopId The shop.
 * @returns The number, 0 before the first change.
 */
export function catalogVersion(shopId: number): number {
	return versions.get(shopId) ?? 0;
}

/**
 * Say a shop's products, variants, categories, stock or package
 * slots changed. Every copy of its catalog in memory is now stale.
 * @param shopId The shop.
 */
export function catalogChanged(shopId: number): void {
	versions.set(shopId, catalogVersion(shopId) + 1);
}
