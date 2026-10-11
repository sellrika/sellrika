import { tmpdir } from "node:os"; // Bun has no equivalent
import { afterAll, expect, test } from "bun:test";
import { Container } from "@xcore/di";
import type { MarketingCustomer } from "@models/Campaign";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`; // before any app import
process.env.APP_KEY ??= "unit-test-key"; // the unsubscribe links are signed with it
const { Db, sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { MarketingService: _MarketingService } = await import(
	"../marketing/Marketing.Service"
);
const { CampaignRepository: _CampaignRepository } = await import(
	"@repositories/Campaign.Repository"
);
const { StoreCartRepository: _StoreCartRepository } = await import(
	"@repositories/StoreCart.Repository"
);
const { MailService: _MailService } = await import(
	"@services/settings/Mail.Service"
);
const { unsubscribeToken, readUnsubscribeToken } = await import(
	"@helpers/crypto"
);
const { AbandonedInput, CampaignInput, ScheduleInput } = await import(
	"@validators/Marketing.Validator"
);
const { sqlStamp } = await import("@helpers/time");
const Marketing = Container.get(_MarketingService);
const Campaigns = Container.get(_CampaignRepository);
const Carts = Container.get(_StoreCartRepository);
const Mail = Container.get(_MailService);

await migrate(true);

const run = `${process.pid}-${Date.now().toString(36)}`;
const [shop] = await Db.insert(
	sql,
	"shops",
	sql`insert into shops (name, currency, timezone, slug, online_enabled, abandoned_cart, abandoned_cart_hours)
  values ('Mkt Shop', 'USD', 'UTC', ${`mkt-${run}`}, ${true}, ${true}, 1)`,
	sql`id`,
);
const S = Number(shop.id);

/** Every email "sent" by the stubbed MailService. */
const sent: { to: string; subject: string; text: string; headers?: object }[] =
	[];
const real = { config: Mail.config, send: Mail.send };
Mail.config = async () => ({
	mailer: {} as any,
	creds: {},
	from_email: "noreply@x.io",
	own: false,
});
Mail.send = async (m) => {
	const c = await m.build();
	sent.push({ to: m.to, ...c });
	return null;
};
afterAll(() => {
	Mail.config = real.config;
	Mail.send = real.send;
});

/**
 * A checkout snapshot made some minutes ago.
 * @param email The buyer's email.
 * @param minutesAgo How old the cart is.
 * @returns The cart id.
 */
async function cart(email: string, minutesAgo: number) {
	const c = await Carts.create(S, {
		items: [
			{
				product_id: 1,
				variant_id: null,
				name: "Mkt Mug",
				price: 1250,
				cost: null,
				qty: 2,
				track_stock: false,
			},
		],
		subtotal: 2500,
		total: 2500,
		customer: {
			name: "Ann",
			phone: "",
			email,
			address_1: "",
			address_2: "",
			city: "",
			state: "",
			country: "",
			postal_code: "",
		},
	});
	const at = sqlStamp(new Date(Date.now() - minutesAgo * 60_000));
	await sql`update store_carts set created_at = ${at} where id = ${c.id}`;
	return c.id;
}

/**
 * Emails sent to one address so far.
 * @param to The address.
 * @returns How many.
 */
function to(to: string) {
	return sent.filter((m) => m.to === to).length;
}

test("unsubscribe token: round trip, other shop and tampering fail", () => {
	const tok = unsubscribeToken(S, " Ann@X.io ");
	expect(readUnsubscribeToken(S, tok)).toBe("ann@x.io");
	expect(readUnsubscribeToken(S + 1, tok)).toBeNull(); // signed for one shop only
	expect(readUnsubscribeToken(S, `${tok}x`)).toBeNull();
	const other = Buffer.from("bob@x.io").toString("base64url");
	expect(readUnsubscribeToken(S, `${other}.${tok.split(".")[1]}`)).toBeNull();
	expect(readUnsubscribeToken(S, "garbage")).toBeNull();
});

test("validators: delay from the list, schedule needs a time, ids deduped", () => {
	expect(AbandonedInput.safeParse({ enabled: true, hours: 4 }).success).toBe(
		true,
	);
	expect(AbandonedInput.safeParse({ enabled: true, hours: 5 }).success).toBe(
		false,
	);
	expect(ScheduleInput.safeParse({ now: true }).success).toBe(true);
	expect(ScheduleInput.safeParse({ date: "2030-01-01" }).success).toBe(false);
	expect(
		ScheduleInput.safeParse({ date: "2030-01-01", time: "09:30" }).success,
	).toBe(true);
	const c = CampaignInput.parse({ subject: " Hi ", customer_ids: [3, 3, 4] });
	expect(c).toEqual({
		subject: "Hi",
		body: "",
		product_ids: [],
		customer_ids: [3, 4],
	});
	expect(CampaignInput.safeParse({ subject: "" }).success).toBe(false);
	expect(
		CampaignInput.safeParse({
			subject: "x",
			product_ids: [1, 2, 3, 4, 5, 6, 7],
		}).success,
	).toBe(false); // at most CAMPAIGN_MAX_PRODUCTS
});

test("abandoned cart: due once, not too early, skips ordered / unsubscribed / older duplicate", async () => {
	const due = await cart(`due-${run}@x.io`, 120);
	await cart(`early-${run}@x.io`, 30); // the shop waits 1 hour
	const ordered = `ordered-${run}@x.io`;
	await cart(ordered, 120);
	const [cust] = await Db.insert(
		sql,
		"customers",
		sql`insert into customers (shop_id, name, email) values (${S}, 'O', ${ordered})`,
		sql`id`,
	);
	await sql`insert into orders (shop_id, user_id, customer_id, total, paid) values (${S}, 1, ${cust.id}, 100, 100)`;
	const gone = `gone-${run}@x.io`;
	await cart(gone, 120);
	await Marketing.unsubscribe(S, unsubscribeToken(S, gone));
	const twice = `twice-${run}@x.io`;
	const old = await cart(twice, 150);
	const newer = await cart(twice, 90);

	await Marketing.abandoned();
	expect(to(`due-${run}@x.io`)).toBe(1);
	expect(to(`early-${run}@x.io`)).toBe(0);
	expect(to(ordered)).toBe(0);
	expect(to(gone)).toBe(0);
	expect(to(twice)).toBe(1); // only the newer checkout is emailed
	const [o] = await sql`select reminded_at from store_carts where id = ${old}`;
	const [n] =
		await sql`select reminded_at from store_carts where id = ${newer}`;
	expect(o.reminded_at).toBeNull();
	expect(n.reminded_at).not.toBeNull();

	// the email: items, total, the restore link and the unsubscribe header
	const mail = sent.find((m) => m.to === `due-${run}@x.io`)!;
	expect(mail.subject).toBe("You left something in your cart at Mkt Shop");
	expect(mail.text).toContain("2 × Mkt Mug");
	expect(mail.text).toContain("$25");
	const token = mail.text.match(/\/cart\/(\w+)/)![1]!;
	expect(mail.headers).toHaveProperty("List-Unsubscribe");

	// the link gives the lines back; a wrong key gives nothing
	expect(await Marketing.restore(S, token)).toEqual([
		{
			product_id: 1,
			variant_id: null,
			name: "Mkt Mug",
			image: null,
			price: 1250,
			qty: 2,
			note: "",
		},
	]);
	expect(await Marketing.restore(S, "nope")).toBeNull();
	expect(await Marketing.restore(S + 1, token)).toBeNull();

	// a second sweep sends nothing more
	const before = sent.length;
	await Marketing.abandoned();
	expect(sent.length).toBe(before);
	expect(due).toBeGreaterThan(0);

	// the gateway re-check only looks at carts younger than a day
	await sql`update store_carts set stripe_session_id = ${`cs_old_${run}`}, created_at = ${sqlStamp(new Date(Date.now() - 2 * 86_400_000))} where id = ${old}`;
	const checked = await Carts.due(new Date());
	expect(checked.some((c) => c.id === old)).toBe(false);
});

test("campaigns: sent once, unsubscribed skipped, a crash never re-sends", async () => {
	const email = (n: string) => `${n}-${run}@x.io`;
	const ids: number[] = [];
	for (const n of ["c1", "c2", "c3"]) {
		const [c] = await Db.insert(
			sql,
			"customers",
			sql`insert into customers (shop_id, name, email) values (${S}, ${n}, ${email(n)})`,
			sql`id`,
		);
		ids.push(Number(c.id));
	}
	const [noMail] = await Db.insert(
		sql,
		"customers",
		sql`insert into customers (shop_id, name) values (${S}, 'nomail')`,
		sql`id`,
	);
	await Marketing.unsubscribe(S, unsubscribeToken(S, email("c2")));

	// the picker marks the unsubscribed one; "select all" leaves it out
	const pick = await Campaigns.customers(S, `-${run}@`, 1, 20);
	expect(pick.data.find((c) => c.id === ids[1])?.unsubscribed).toBe(true);
	expect(await Campaigns.customerIds(S, `-${run}@`, 100)).toEqual(
		expect.arrayContaining([ids[0], ids[2]]),
	);
	expect(await Campaigns.customerIds(S, `-${run}@`, 100)).not.toContain(ids[1]);

	const c = await Campaigns.create(
		S,
		{
			subject: `News ${run}`,
			body: "<p>Hello</p>",
			product_ids: [],
			customer_ids: [...ids, Number(noMail.id)],
		},
		1,
	);
	await Campaigns.schedule(c.id, S, new Date(Date.now() - 60_000));
	// two sweeps at once: the claim + the booked rows keep it to one email each
	const campaigns = Container.get(
		(await import("../marketing/Campaign.Service")).CampaignService,
	);
	await Promise.all([campaigns.sweep(), campaigns.sweep()]);
	expect(to(email("c1"))).toBe(1);
	expect(to(email("c2"))).toBe(0); // unsubscribed
	expect(to(email("c3"))).toBe(1);
	const done = (await Campaigns.find(c.id, S))!;
	expect(done.status).toBe("sent");
	expect(done.sent).toBe(2);
	expect(done.failed).toBe(1);
	const mail = sent.find((m) => m.to === email("c1"))!;
	expect(mail.subject).toBe(`News ${run}`);
	expect(mail.text).toContain("Hello");
	expect(mail.text).toContain(`//mkt-${run}.localhost:3000/unsubscribe/`); // the store's subdomain

	// sent is final: another sweep, a schedule or an edit change nothing
	await campaigns.sweep();
	expect(to(email("c1"))).toBe(1);
	expect(await Campaigns.schedule(c.id, S, new Date())).toBe(false);

	// a crash mid-send: c1 was booked, the campaign is still "sending"
	const crash = await Campaigns.create(
		S,
		{ subject: "Crash", body: "", product_ids: [], customer_ids: ids },
		1,
	);
	await sql`update campaigns set status = 'sending' where id = ${crash.id}`;
	await Campaigns.book(crash.id, ids[0]!, email("c1"));
	await campaigns.sweep();
	expect(sent.filter((m) => m.subject === "Crash").map((m) => m.to)).toEqual([
		email("c3"),
	]);
	expect((await Campaigns.find(crash.id, S))!.status).toBe("sent");
	// nothing deletes a campaign while it sends; a sent one can go
	expect(await Campaigns.remove(crash.id, S)).toBe(true);
});

test("campaigns: the email queue is in the database, so a restart loses nothing", async () => {
	const email = (n: string) => `q${n}-${run}@x.io`;
	const people: MarketingCustomer[] = [];
	for (const n of ["1", "2", "3"]) {
		const [c] = await Db.insert(
			sql,
			"customers",
			sql`insert into customers (shop_id, name, email) values (${S}, ${`q${n}`}, ${email(n)})`,
			sql`id`,
		);
		people.push({
			id: Number(c.id),
			name: `q${n}`,
			email: email(n),
			unsubscribed: false,
		});
	}
	const c = await Campaigns.create(
		S,
		{
			subject: `Queue ${run}`,
			body: "",
			product_ids: [],
			customer_ids: people.map((p) => p.id),
		},
		1,
	);
	// the server stopped after the queue was written: q1 was being sent, q2 and q3 still wait
	await sql`update campaigns set status = 'sending' where id = ${c.id}`;
	await Campaigns.enqueue(c.id, people, false, "unsubscribed");
	await Campaigns.enqueue(c.id, people, false, "unsubscribed"); // twice: nobody is queued twice
	const queued =
		await sql`select * from email_queue where kind = 'campaign' and group_id = ${c.id} order by id`;
	expect(queued.map((q: { to_email: string }) => q.to_email)).toEqual(
		people.map((p) => p.email),
	);
	await sql`update email_queue set status = 'sending' where id = ${queued[0].id}`;

	// after the restart the sweep sends what still waits, and never the cut-off one
	const { CampaignService } = await import("../marketing/Campaign.Service");
	await Container.get(CampaignService).sweep();
	const got = sent.filter((m) => m.subject === `Queue ${run}`).map((m) => m.to);
	expect(got.toSorted()).toEqual([email("2"), email("3")]);
	const done = (await Campaigns.find(c.id, S))!;
	expect(done.status).toBe("sent");
	expect(done.sent).toBe(2);
	expect(done.failed).toBe(1);
	expect(
		(await sql`select 1 from email_queue where group_id = ${c.id}`).length,
	).toBe(0); // a finished campaign leaves nothing in the queue
});

test("campaigns: through the platform's email an account sends at most its monthly limit", async () => {
	const { CAMPAIGN_EMAILS_PER_MONTH } = await import(
		"@constants/Marketing.Constant"
	);
	const { CampaignService } = await import("../marketing/Campaign.Service");
	const { OwnerRepository } = await import("@repositories/Owner.Repository");
	const campaigns = Container.get(CampaignService);
	const owners = Container.get(OwnerRepository);
	const [owner] = await Db.insert(
		sql,
		"users",
		sql`insert into users (name, email, password_hash, role) values ('Cap', ${`cap-${run}@x.io`}, '', 'admin')`,
		sql`id`,
	);
	const ownerId = Number(owner.id);
	/**
	 * Add a shop to the owner.
	 * @param slug Its store slug.
	 * @returns The shop, as the service needs it.
	 */
	async function addShop(slug: string) {
		const [row] = await Db.insert(
			sql,
			"shops",
			sql`insert into shops (name, currency, timezone, slug, online_enabled, owner_id)
      values ('Cap Shop', 'USD', 'UTC', ${`${slug}-${run}`}, ${true}, ${ownerId})`,
		);
		return { ...row, id: Number(row.id), languages: [] } as any;
	}
	const capShop = await addShop("cap");
	const other = await addShop("cap-other");
	const email = (n: string) => `${n}-cap-${run}@x.io`;
	const ids: number[] = [];
	for (const n of ["a", "b"]) {
		const [c] = await Db.insert(
			sql,
			"customers",
			sql`insert into customers (shop_id, name, email) values (${capShop.id}, ${n}, ${email(n)})`,
			sql`id`,
		);
		ids.push(Number(c.id));
	}
	/**
	 * A draft campaign of the shop to both customers.
	 * @param subject Its subject.
	 * @returns The campaign.
	 */
	function draft(subject: string) {
		return Campaigns.create(
			capShop.id,
			{ subject, body: "", product_ids: [], customer_ids: ids },
			1,
		);
	}
	// the platform admin set this owner to 3 a month; the other shop sent 2 through
	// the platform's email this month, and 5 through its own email (those don't count)
	expect(await owners.setCampaignLimit(ownerId, 3)).toBe(true);
	const old = await Campaigns.create(
		other.id,
		{ subject: "Old", body: "", product_ids: [], customer_ids: [] },
		1,
	);
	for (let i = 1; i <= 7; i++)
		await sql`insert into campaign_sends (campaign_id, customer_id, email, sent_at, platform)
      values (${old.id}, ${i}, 'x', ${sqlStamp(new Date())}, ${i <= 2})`;

	// the shops have no own email: only the platform's works
	const own = Mail.config;
	Mail.config = async (shopId?: number) => (shopId ? null : own());
	try {
		const c = await draft(`Cap ${run}`);
		await Campaigns.schedule(c.id, capShop.id, new Date(Date.now() - 60_000));
		await campaigns.sweep();
		expect(to(email("a"))).toBe(1);
		expect(to(email("b"))).toBe(0); // over the limit
		const done = (await Campaigns.find(c.id, capShop.id))!;
		expect(done.sent).toBe(1);
		expect(done.failed).toBe(1);
		// nothing left this month: a new schedule is refused
		const next = await draft("Next");
		const r = await campaigns.schedule(capShop, next.id, { now: true } as any);
		expect(r.errors?.date).toBeString();
		// back to the default: room again
		await owners.setCampaignLimit(ownerId, null);
		expect(await owners.campaignLimit(ownerId)).toBeNull();
		const again = await campaigns.schedule(capShop, next.id, {
			now: true,
		} as any);
		expect(again.errors).toBeUndefined();
		expect(CAMPAIGN_EMAILS_PER_MONTH).toBe(1000);
	} finally {
		Mail.config = own;
	}
	// with its own email the shop has no limit, even at 0
	await owners.setCampaignLimit(ownerId, 0);
	const res = await campaigns.schedule(capShop, (await draft("Own")).id, {
		now: true,
	} as any);
	expect(res.errors).toBeUndefined();
});

test("campaigns: one account sends one campaign at a time", async () => {
	const { CampaignService } = await import("../marketing/Campaign.Service");
	const campaigns = Container.get(CampaignService);
	const [owner] = await Db.insert(
		sql,
		"users",
		sql`insert into users (name, email, password_hash, role) values ('Busy', ${`busy-${run}@x.io`}, '', 'admin')`,
		sql`id`,
	);
	const [row] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, timezone, slug, online_enabled, owner_id)
    values ('Busy Shop', 'USD', 'UTC', ${`busy-${run}`}, ${true}, ${Number(owner.id)})`,
	);
	const busyShop = { ...row, id: Number(row.id), languages: [] } as any;
	const [cust] = await Db.insert(
		sql,
		"customers",
		sql`insert into customers (shop_id, name, email) values (${busyShop.id}, 'b', ${`b-busy-${run}@x.io`})`,
		sql`id`,
	);
	/**
	 * A draft campaign to the one customer.
	 * @param subject Its subject.
	 * @returns The campaign.
	 */
	function draft(subject: string) {
		return Campaigns.create(
			busyShop.id,
			{ subject, body: "", product_ids: [], customer_ids: [Number(cust.id)] },
			1,
		);
	}
	// a due campaign, and an older one of the same account still sending
	const waiting = await draft(`Waiting ${run}`);
	const first = await draft(`First ${run}`);
	await sql`update campaigns set status = 'sending' where id = ${first.id}`;
	await Campaigns.schedule(
		waiting.id,
		busyShop.id,
		new Date(Date.now() - 60_000),
	);

	// "Send now" is refused while one is sending
	const now = await draft("Now");
	const r = await campaigns.schedule(busyShop, now.id, { now: true } as any);
	expect(r.errors?.date).toBeString();

	// the sweep finishes the sending one; the due one waits for the next sweep
	await campaigns.sweep();
	expect((await Campaigns.find(first.id, busyShop.id))!.status).toBe("sent");
	expect((await Campaigns.find(waiting.id, busyShop.id))!.status).toBe(
		"scheduled",
	);
	await campaigns.sweep();
	expect((await Campaigns.find(waiting.id, busyShop.id))!.status).toBe("sent");
	// nothing sending any more: "Send now" works again
	const again = await campaigns.schedule(busyShop, now.id, {
		now: true,
	} as any);
	expect(again.errors).toBeUndefined();
});

test("campaign pictures travel inside the email by cid; one that can't be read is dropped", async () => {
	const { UPLOAD_DIR } = await import("@constants/Storage.Constant");
	const { CampaignEmail } = await import("@emails/Campaign.Email");
	// a real 1×1 PNG, blown up to a big picture
	const dot = Uint8Array.fromBase64(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	);
	const bytes = await new Bun.Image(dot)
		.resize(2000, 1000, { fit: "fill" })
		.png()
		.bytes();
	const name = `${Bun.randomUUIDv7()}.png`;
	await Bun.write(`${UPLOAD_DIR}/uploads/${name}`, bytes);
	const png = `/uploads/${name}`;
	const [row] = await sql`select * from shops where id = ${S}`;
	const parts = await CampaignEmail.parts(
		{ ...row, logo: null },
		{
			subject: "Sale",
			body: `<p>Hi</p><img src="${png}" alt="a"><img src="/uploads/gone-0.png" alt="b">`,
		},
		[{ name: "Mug", price: 1800, slug: "mug", image: png }],
	);
	expect(parts.products[0]!.image).toBe("cid:product-0@pos");
	expect(parts.html).toContain('src="cid:body-0@pos"');
	expect(parts.html).not.toContain("/uploads/"); // no link left to break later
	expect(parts.html).not.toContain('alt="b"'); // a missing picture is dropped, not shown broken
	expect(parts.inline.map((f) => f.cid)).toEqual([
		"product-0@pos",
		"body-0@pos",
	]);
	const { width } = await new Bun.Image(parts.inline[1]!.content).metadata();
	expect(width).toBe(112); // the same size as an order email's line picture
	// every recipient's email shares the same pictures
	const email = await new CampaignEmail("a@x.io", row, parts, "u").build();
	expect(email.inline).toBe(parts.inline);
	expect(email.html).toContain("cid:product-0@pos");
});
