import { expect, test } from "bun:test";
import { RateLimit } from "@xcore/http/RateLimit";
import { Url } from "@xcore/http/Url";

const req = (url = "http://x/y") => new Request(url);
const ok = () => new Response("ok", { status: 200 });

test("fixed window: allows up to the limit, then refuses until it resets", () => {
	RateLimit.reset();
	const now = 1_000_000;
	for (let i = 0; i < 3; i++)
		expect(RateLimit.take("k", 3, 60_000, now).allowed).toBe(true);
	const blocked = RateLimit.take("k", 3, 60_000, now);
	expect(blocked.allowed).toBe(false);
	expect(blocked.retryAfter).toBe(60);
	expect(RateLimit.take("k", 3, 60_000, now + 60_001).allowed).toBe(true); // window rolled over
	expect(RateLimit.take("other", 3, 60_000, now).allowed).toBe(true); // buckets are independent
});

test("middleware answers 429 with Retry-After once the budget is gone", async () => {
	RateLimit.reset();
	const guard = RateLimit.middleware("t1", {
		limit: 2,
		windowMs: 60_000,
		message: "server.rate_requests",
	})(ok);
	expect((await guard(req() as any)).status).toBe(200);
	expect((await guard(req() as any)).status).toBe(200);
	const res = await guard(req() as any);
	expect(res.status).toBe(429);
	expect(await res.text()).toBe("Too many requests. Slow down a moment.");
	expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
});

test("`counts` spends budget only on the responses that matter", async () => {
	RateLimit.reset();
	let status = 303;
	const guard = RateLimit.middleware(
		"t2",
		{ limit: 1, windowMs: 60_000, message: "server.rate_requests" },
		{ counts: (r) => r.status !== 303 },
	)(() => new Response(null, { status }));
	for (let i = 0; i < 5; i++)
		expect((await guard(req() as any)).status).toBe(303); // successes are free
	status = 422;
	expect((await guard(req() as any)).status).toBe(422); // one failure charged
	expect((await guard(req() as any)).status).toBe(429); // budget gone
});

test("parallel requests can't all pass before any is counted", async () => {
	RateLimit.reset();
	let release = () => {};
	const slow = new Promise<void>((r) => {
		release = r;
	});
	const guard = RateLimit.middleware("t4", {
		limit: 2,
		windowMs: 60_000,
		message: "server.rate_requests",
	})(async () => {
		await slow;
		return ok();
	});
	const all = Array.from({ length: 10 }, () => guard(req() as any));
	release();
	const codes = (await Promise.all(all)).map((r) => r.status);
	expect(codes.filter((c) => c === 200).length).toBe(2);
});

test("`render` shapes the 429 (the login form shows it inline)", async () => {
	RateLimit.reset();
	const guard = RateLimit.middleware(
		"t3",
		{ limit: 0, windowMs: 60_000, message: "server.rate_attempts" },
		{
			render: (_req, message) =>
				Response.json({ errors: { email: message } }, { status: 429 }),
		},
	)(ok);
	const res = await guard(req() as any);
	expect(res.status).toBe(429);
	expect(await res.json()).toEqual({
		errors: { email: "Too many attempts. Try again in a few minutes." },
	});
});

test("samePath keeps a redirect on this origin", () => {
	// whatever the header says, what comes back is always a path on *this* site
	expect(Url.samePath("https://evil.com/steal")).toBe("/steal"); // host dropped, path kept
	expect(Url.samePath("//evil.com/steal")).toBe("/steal"); // protocol-relative: host dropped too
	expect(Url.samePath("https://evil.com")).toBe("/");
	expect(Url.samePath("  https://evil.com/x")).toBe("/x"); // leading space doesn't smuggle a host through
	expect(Url.samePath("/\\/evil.com")).toBe("/"); // backslashes normalise to a host, which is dropped
	expect(Url.samePath("javascript:alert(1)")).toBe("/");
	expect(Url.samePath("http://x/orders?page=2")).toBe("/orders?page=2"); // query survives
	expect(Url.samePath("/products/9/edit")).toBe("/products/9/edit");
	expect(Url.samePath(null, "/pos")).toBe("/pos");
	expect(Url.samePath("", "/pos")).toBe("/pos");
});
