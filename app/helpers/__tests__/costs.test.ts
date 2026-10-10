import { expect, test } from "bun:test";
import { responseWithoutCosts, withoutCosts } from "@helpers/costs";

test("withoutCosts: the cost fields are null at any depth, the rest is untouched", async () => {
	const page = {
		data: [
			{
				id: 1,
				price: 500,
				purchase_price: 200,
				variants: [{ id: 2, purchase_price: 150 }],
			},
		],
		order: { total: 500, items: [{ name: "Mug", price: 500, cost: 200 }] },
	};
	expect(withoutCosts(page) as unknown).toEqual({
		data: [
			{
				id: 1,
				price: 500,
				purchase_price: null,
				variants: [{ id: 2, purchase_price: null }],
			},
		],
		order: { total: 500, items: [{ name: "Mug", price: 500, cost: null }] },
	});
	expect(page.data[0]!.purchase_price).toBe(200); // the rows themselves are not changed

	const res = await responseWithoutCosts(Response.json(page, { status: 201 }));
	expect(res.status).toBe(201);
	expect((await res.json()).order.items[0].cost).toBeNull();
	const text = new Response("cost: 5");
	expect(await responseWithoutCosts(text)).toBe(text); // not JSON: left alone
});
