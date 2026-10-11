import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
const { Db, sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { PaymentMethodService: _PaymentMethodService } = await import(
	"../PaymentMethod.Service"
);
const PaymentMethodService = Container.get(_PaymentMethodService);
const { PaymentMethodRepository: _PaymentMethodRepository } = await import(
	"@repositories/PaymentMethod.Repository"
);
const PaymentMethodRepository = Container.get(_PaymentMethodRepository);

await migrate(true);
const [shop] = await Db.insert(
	sql,
	"shops",
	sql`insert into shops (name, currency) values ('Pay', 'USD')`,
	sql`id`,
);
const S = shop.id as number;

test("payment methods: defaults, enabled filter, usable(), keep-one rule", async () => {
	await PaymentMethodRepository.seedDefaults(S);
	expect(
		(await PaymentMethodService.list(S)).map((m) => [
			m.name,
			m.tendered,
			m.enabled,
		]),
	).toEqual([
		["Cash", true, true],
		["Card", false, true],
		["Other", false, true],
	]);
	const card = (await PaymentMethodService.list(S))[1]!;
	await PaymentMethodService.update(card.id, S, {
		name: "Card",
		icon: "CreditCard",
		color: null,
		image: null,
		tendered: false,
		enabled: false,
	});
	expect(
		(await PaymentMethodService.listEnabled(S)).map((m) => m.name),
	).toEqual(["Cash", "Other"]);
	expect(await PaymentMethodRepository.usable(S, "Card")).toBe(false);
	expect(await PaymentMethodRepository.usable(S, "Cash")).toBe(true);
	expect(await PaymentMethodRepository.usable(S, "Bitcoin")).toBe(false);
	const qr = await PaymentMethodService.create(S, {
		name: "QR",
		icon: "QrCode",
		color: "#00ff00",
		image: "/uploads/1/payments/qr.png", // the picture for the customer's screen
		tendered: false,
		enabled: true,
	});
	expect(qr.position).toBe(3);
	expect(qr.image).toBe("/uploads/1/payments/qr.png");
	// taken off again by an update that sends none
	expect(
		(await PaymentMethodService.update(qr.id, S, {
			name: "QR",
			icon: "QrCode",
			color: "#00ff00",
			image: null,
			tendered: false,
			enabled: true,
		}))!.image,
	).toBeNull();
	for (const m of await PaymentMethodService.list(S))
		if (m.name !== "QR")
			expect(await PaymentMethodService.remove(m.id, S)).toBeNull();
	expect(await PaymentMethodService.remove(qr.id, S)).toBe(
		"Keep at least one payment method",
	);
	expect(await PaymentMethodRepository.count(S)).toBe(1);
});
