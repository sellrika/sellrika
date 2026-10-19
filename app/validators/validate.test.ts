import { expect, test } from "bun:test";
import { ProductInput } from "./Product.Validator";
import { validate } from "./validate";

test("validate(ProductInput)", () => {
	const ok = validate(ProductInput, {
		name: " Tea ",
		price: "250",
		variants: [{ name: "Large", price: 300 }],
		category_ids: ["1"],
	});
	expect(ok.data).toMatchObject({
		name: "Tea",
		price: 250,
		images: [],
		category_ids: [1],
		variants: [{ name: "Large", price: 300, images: [] }],
	});
	expect(
		validate(ProductInput, { name: "x", price: 1, barcode: "  " }).data
			?.barcode,
	).toBeNull();
	expect(
		validate(ProductInput, { name: "x", price: 1, barcode: " 4006381333931 " })
			.data?.barcode,
	).toBe("4006381333931");
	expect(
		validate(ProductInput, {
			name: "x",
			price: 1,
			variants: [
				{ name: "S", price: 1, barcode: "" },
				{ name: "M", price: 1, barcode: "123" },
			],
		}).data?.variants.map((v) => v.barcode),
	).toEqual([null, "123"]);
	const bad = validate(ProductInput, {
		name: "",
		price: 1.5,
		images: ["/uploads/a.png", "http://evil"],
		variants: [{ name: "", price: -1, images: ["x"] }],
	});
	expect(bad.errors).toEqual({
		name: "Name is required",
		price: "Price must be a whole number of cents",
		"images.1": "Invalid image",
		"variants.0.name": "Variant name is required",
		"variants.0.price": "Variant price must be ≥ 0",
		"variants.0.images.0": "Invalid image",
	});
	const variant = (attributes: Record<string, string>) =>
		validate(ProductInput, {
			name: "x",
			price: 1,
			variants: [{ name: "S", price: 1, attributes }],
		}).errors;
	expect(variant({ Size: "S" })).toBeUndefined();
	expect(variant({ Size: "x".repeat(201) })).toEqual({
		"variants.0.attributes.Size": "Value is too long",
	});
	expect(
		variant(Object.fromEntries([...Array(101)].map((_, i) => [`k${i}`, "v"]))),
	).toEqual({ "variants.0.attributes": "Too many" });
});

test("validate(CheckoutInput / RefundInput / StockAdjustInput / CustomerInput / user inputs)", async () => {
	const { CheckoutInput, RefundInput } = await import("./Order.Validator");
	const { StockAdjustInput } = await import("./Stock.Validator");
	const { CustomerInput } = await import("./Customer.Validator");
	const { EditUserInput, NewUserInput } = await import("./User.Validator");
	const base = {
		items: [{ product_id: 1, qty: 1 }],
		paid: 100,
		payment_method: "Cash",
	};
	expect(validate(CheckoutInput, base).data).toMatchObject({
		customer_id: null,
		discount_type: null,
		discount_value: 0,
		items: [{ variant_id: null }],
	});
	expect(
		validate(CheckoutInput, {
			...base,
			discount_type: "percent",
			discount_value: 120,
		}).errors,
	).toEqual({ discount_value: "Percent must be 0–100" });
	expect(
		validate(CheckoutInput, {
			...base,
			discount_type: "fixed",
			discount_value: 120,
		}).data?.discount_value,
	).toBe(120);
	expect(validate(CheckoutInput, { ...base, items: [] }).errors?.items).toBe(
		"Cart is empty",
	);
	expect(validate(RefundInput, { amount: 0 }).errors?.amount).toMatch(
		/more than zero/,
	);
	expect(
		validate(RefundInput, { amount: 5, items: [{ order_item_id: 2, qty: 1 }] })
			.data,
	).toEqual({
		amount: 5,
		reason: "",
		restock: true,
		items: [{ order_item_id: 2, qty: 1 }],
	});
	expect(
		validate(StockAdjustInput, { product_id: 1, reason: "received" }).errors
			?.delta,
	).toBe("Enter a quantity");
	expect(
		validate(StockAdjustInput, { product_id: 1, reason: "count", set: 3 }).data,
	).toMatchObject({ set: 3, delta: null, variant_id: null });
	expect(
		validate(StockAdjustInput, { product_id: 1, reason: "nope", delta: 1 })
			.errors?.reason,
	).toBe("Pick a reason");
	expect(
		validate(CustomerInput, { name: " Ann ", phone: " ", email: "" }).data,
	).toEqual({ name: "Ann", phone: null, email: null, note: "" });
	expect(
		validate(CustomerInput, { name: "Ann", email: "nope" }).errors?.email,
	).toBe("Enter a valid email");
	expect(
		validate(NewUserInput, {
			name: "A",
			email: "A@X.io",
			password: "short",
			role: "admin",
		}).errors?.password,
	).toMatch(/8 characters/);
	expect(
		validate(NewUserInput, {
			name: "A",
			email: "A@X.io",
			password: "longenough",
			role: "admin",
		}).data?.email,
	).toBe("a@x.io");
	expect(
		validate(EditUserInput, { name: "A", email: "a@x.io", role: "cashier" })
			.data,
	).toMatchObject({ active: true, password: "" });
	expect(
		validate(EditUserInput, {
			name: "A",
			email: "a@x.io",
			role: "cashier",
			password: "abc",
		}).errors?.password,
	).toMatch(/8 characters/);
});

test("SalesStaffInput: the commission stays between 0% and 100%", async () => {
	const { SalesStaffInput } = await import("./SalesStaff.Validator");
	expect(
		validate(SalesStaffInput, { name: " Ann ", commission: 250 }).data,
	).toEqual({
		name: "Ann",
		commission: 250,
		active: true,
	});
	for (const commission of [-1, 10001, 2.5])
		expect(
			validate(SalesStaffInput, { name: "Ann", commission }).errors,
		).toEqual({
			commission: "Commission must be between 0% and 100%",
		});
});
