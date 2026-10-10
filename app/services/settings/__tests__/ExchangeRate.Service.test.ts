import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
const { sql } = await import("@xcore/database/Database");
const registry = await import("@database/migrations");
const { ExchangeRateService: _ExchangeRateService } = await import(
	"../ExchangeRate.Service"
);
const rates = Container.get(_ExchangeRateService);
const { StoreService: _StoreService } = await import(
	"@services/sales/Store.Service"
);
const store = Container.get(_StoreService);
const { ShopRepository: _ShopRepository } = await import(
	"@repositories/Shop.Repository"
);
const shops = Container.get(_ShopRepository);
const { StoreCurrenciesInput, RateScheduleInput } = await import(
	"@validators/Store.Validator"
);
const { validate } = await import("@validators/validate");

const migrated = await sql`select 1 from users`.then(
	() => true,
	() => false,
);
if (!migrated)
	for (const [, up] of Object.entries(registry).sort(([a], [b]) =>
		a.localeCompare(b),
	))
		await up(sql);

/** The provider's answer, as open.er-api.com sends it. */
const answer = (r: Record<string, unknown>) =>
	Response.json({ result: "success", base_code: "USD", rates: r });
let calls = 0;
/**
 * Make the stub provider answer with this.
 * @param res What the next fetches get.
 */
function provider(res: () => Response) {
	rates.fetcher = async () => {
		calls++;
		return res();
	};
}

test("exchange rates: default schedule, refresh stores the table, a failure keeps it", async () => {
	expect(await rates.schedule()).toBe("1d");
	expect((await rates.rates()).fetched_at).toBeNull();

	provider(() => answer({ USD: 1, EUR: 0.5, THB: 35, BAD: -1, xx: 3 }));
	const r = await rates.refresh();
	expect(r.error).toBeNull();
	expect(r.base).toBe("USD");
	expect(r.rates).toEqual({ USD: 1, EUR: 0.5, THB: 35 }); // nonsense values and codes dropped
	expect(r.fetched_at).toBeString();

	// `tried_at` has millisecond precision: two refreshes in the same
	// millisecond would carry the same stamp and fail the check below
	await Bun.sleep(2);
	provider(() => new Response("down", { status: 503 }));
	const failed = await rates.refresh();
	expect(failed.error).toBe("HTTP 503");
	expect(failed.rates).toEqual({ USD: 1, EUR: 0.5, THB: 35 }); // the old table stays
	expect(failed.fetched_at).toBe(r.fetched_at);
	expect(failed.tried_at).not.toBe(r.tried_at);

	provider(() => Response.json({ result: "error" }));
	expect((await rates.refresh()).error).toBe("The answer held no rates");
});

test("exchange rates: run() fetches only when the schedule says so", async () => {
	provider(() => answer({ USD: 1, EUR: 0.5, THB: 35 }));
	const tried = Date.parse((await rates.rates()).tried_at!);

	await rates.setSchedule("off");
	expect(await rates.run(tried + 10 * 86_400_000)).toBe(false);

	await rates.setSchedule("30m");
	expect(await rates.schedule()).toBe("30m");
	calls = 0;
	expect(await rates.run(tried + 10 * 60_000)).toBe(false); // 10 minutes later: not yet
	expect(await rates.run(tried + 31 * 60_000)).toBe(true);
	expect(calls).toBe(1);

	await rates.setSchedule("1d");
	const again = Date.parse((await rates.rates()).tried_at!);
	expect(await rates.run(again + 3_600_000)).toBe(false);
	expect(await rates.run(again + 86_400_000)).toBe(true);
});

test("exchange rates: a shop's currencies — saved, own currency dropped, manual beats automatic", async () => {
	provider(() => answer({ USD: 1, EUR: 0.5, THB: 35 }));
	await rates.refresh();
	const shop = await shops.create(
		{
			name: "FX",
			currency: "THB",
			logo: null,
			timezone: "UTC",
			tax_rate: 0,
			tax_label: "Tax",
			tax_included: false,
		},
		"fx-rates-test",
		9301,
	);
	expect(shop.currencies).toEqual([]);
	expect(await rates.forShop(shop)).toEqual([]);

	const v = validate(StoreCurrenciesInput, {
		currencies: [
			{ code: "USD", rate: null },
			{ code: "EUR", rate: 0.03 },
			{ code: "EUR", rate: 9 }, // a repeat: the first wins
			{ code: "THB", rate: null }, // its own currency
		],
	});
	expect(v.errors).toBeUndefined();
	await store.updateCurrencies(shop, v.data!);
	const saved = (await shops.find(shop.id))!;
	expect(saved.currencies).toEqual([
		{ code: "USD", rate: null },
		{ code: "EUR", rate: 0.03 },
	]);
	const list = await rates.forShop(saved);
	expect(list.map((c) => c.code)).toEqual(["THB", "USD", "EUR"]);
	expect(list[1]!.rate).toBeCloseTo(1 / 35);
	expect(list[2]!.rate).toBe(0.03);

	// the settings page gets the saved list + the automatic rates from the shop's currency
	const s = await store.settings(shop.id);
	expect(s.currencies).toEqual(saved.currencies);
	expect(s.exchange.rates.EUR).toBeCloseTo(0.5 / 35);
	expect(s.exchange.rates.THB).toBeUndefined();
});

test("exchange rates: input rules", () => {
	expect(
		validate(StoreCurrenciesInput, { currencies: [{ code: "ZZZ", rate: 1 }] })
			.errors,
	).toBeDefined();
	expect(
		validate(StoreCurrenciesInput, { currencies: [{ code: "EUR", rate: 0 }] })
			.errors,
	).toBeDefined();
	expect(
		validate(StoreCurrenciesInput, {
			currencies: Array.from({ length: 21 }, () => ({ code: "EUR", rate: 1 })),
		}).errors,
	).toBeDefined();
	expect(validate(RateScheduleInput, { schedule: "5m" }).errors).toBeDefined();
	expect(validate(RateScheduleInput, { schedule: "6h" }).data).toEqual({
		schedule: "6h",
	});
});
