// The e2e stand-in for download.geonames.org: a static server over e2e/fixtures/geonames (started by playwright.config.ts,
// under Bun like the app servers). The app servers get GEONAMES_ZIP_URL / GEONAMES_DUMP_URL pointing here, so the
// "Cities & postal codes" download in l-store.spec.ts reads zip/TH.zip (fetched from GeoNames once, 14 KB) instead of
// the real site — any other country is a 404 here, the same answer GeoNames gives for a country it doesn't cover.
// It also stands in for Firebase's `accounts:lookup` (FIREBASE_LOOKUP_URL): the customer sign-in in l-store.spec.ts posts the
// token the stubbed browser SDK made, and this answers with one verified user (any other token is refused like Firebase would).
// And for the exchange rates (EXCHANGE_RATES_URL): one fixed table, so the currency spec's prices are known.
// And for Resend (RESEND_API_URL): it keeps the last email per address, and `GET /resend/last?to=` hands it to a spec.
// And for Stripe's subscriptions (STRIPE_API_URL): the app's own paid plan in u-billing.spec.ts.
const mails = new Map<string, unknown>();

/** A checkout the app opened on the Stripe stand-in. */
type Checkout = {
	id: string;
	status: string;
	reference: string;
	amount: number;
	interval: string;
	/** Unix seconds, or null when the charge is due at once. */
	trialEnd: number | null;
	successUrl: string;
	customer: string | null;
	subscription: string | null;
};
/** A subscription a paid checkout made. */
type Plan = { status: string; end: number; cancels: boolean };
const checkouts = new Map<string, Checkout>();
const plans = new Map<string, Plan>();

/**
 * The Stripe stand-in, below `/stripe`.
 * `/stripe/pay/<id>` plays Stripe's hosted page: it pays and sends the browser back.
 * `/stripe/portal/<customer>` plays the portal: it cancels at the period's end.
 * `/stripe/last` hands a spec the last checkout the app opened.
 * @param req The request.
 * @param path Its path, starting with `/stripe/`.
 * @returns The answer Stripe would give.
 */
async function stripe(req: Request, path: string): Promise<Response> {
	const [, , a, b, c] = path.split("/");
	if (a === "last") return Response.json([...checkouts.values()].pop() ?? null);
	if (a === "checkout" && req.method === "POST") {
		const f = new URLSearchParams(await req.text());
		const id = `cs_e2e_${checkouts.size + 1}`;
		const trial = f.get("subscription_data[trial_end]");
		checkouts.set(id, {
			id,
			status: "open",
			reference: f.get("client_reference_id") ?? "",
			amount: Number(f.get("line_items[0][price_data][unit_amount]")),
			interval: f.get("line_items[0][price_data][recurring][interval]") ?? "",
			trialEnd: trial ? Number(trial) : null,
			successUrl: f.get("success_url") ?? "",
			customer: f.get("customer"),
			subscription: null,
		});
		const { origin } = new URL(req.url);
		return Response.json({ id, url: `${origin}/stripe/pay/${id}` });
	}
	if (a === "pay") {
		const s = checkouts.get(b ?? "");
		if (!s) return new Response("Not found", { status: 404 });
		s.status = "complete";
		s.customer ??= `cus_${s.id}`;
		s.subscription = `sub_${s.id}`;
		plans.set(s.subscription, {
			status: s.trialEnd ? "trialing" : "active",
			end: s.trialEnd ?? Math.floor(Date.now() / 1000) + 30 * 86400,
			cancels: false,
		});
		return Response.redirect(
			s.successUrl.replace("{CHECKOUT_SESSION_ID}", s.id),
			302,
		);
	}
	if (a === "checkout") {
		const s = checkouts.get(c ?? "");
		return s
			? Response.json({ ...s, client_reference_id: s.reference })
			: Response.json(
					{ error: { message: "No such session" } },
					{ status: 404 },
				);
	}
	if (a === "subscriptions") {
		const p = plans.get(b ?? "");
		return p
			? Response.json({
					status: p.status,
					cancel_at_period_end: p.cancels,
					items: { data: [{ current_period_end: p.end }] },
				})
			: Response.json({ error: { message: "No such plan" } }, { status: 404 });
	}
	if (a === "billing_portal") {
		const f = new URLSearchParams(await req.text());
		const back = encodeURIComponent(f.get("return_url") ?? "");
		const { origin } = new URL(req.url);
		return Response.json({
			url: `${origin}/stripe/portal/${f.get("customer")}?back=${back}`,
		});
	}
	if (a === "portal") {
		for (const s of checkouts.values())
			if (s.customer === b && s.subscription)
				plans.get(s.subscription)!.cancels = true;
		return Response.redirect(
			new URL(req.url).searchParams.get("back") ?? "/",
			302,
		);
	}
	return new Response("Not found", { status: 404 });
}
const root = `${import.meta.dirname}/geonames`;
Bun.serve({
	port: Number(process.env.PORT),
	async fetch(req) {
		const path = new URL(req.url).pathname;
		if (path === "/health") return new Response("ok");
		if (path.startsWith("/stripe/")) return stripe(req, path);
		if (path === "/resend/emails") {
			const mail = (await req.json()) as { to: string[] };
			for (const to of mail.to) mails.set(to, mail);
			return Response.json({ id: "e2e" });
		}
		if (path === "/resend/last")
			return Response.json(
				mails.get(new URL(req.url).searchParams.get("to") ?? "") ?? null,
			);
		// the exchange rates stand-in (EXCHANGE_RATES_URL): a fixed open.er-api.com-shaped table
		if (path === "/rates")
			return Response.json({
				result: "success",
				base_code: "USD",
				rates: { USD: 1, EUR: 0.5, GBP: 0.8, THB: 35 },
			});
		if (path === "/firebase/lookup") {
			const { idToken } = (await req.json().catch(() => ({}))) as {
				idToken?: string;
			};
			// the staff sign-in with Google (auth.spec.ts): the seeded admin's email,
			// and one that is verified but has no account
			const staff: Record<string, string> = {
				"e2e-staff-token-0123456789": "admin@sellrika.local",
				"e2e-stranger-token-0123456789": "stranger@example.com",
			};
			// Microsoft sign-ins: Firebase does not call their email verified.
			// One is a new person, one only claims the seeded admin's email.
			const unproved: Record<string, string> = {
				"e2e-ms-token-0123456789": "ms-person@example.com",
				"e2e-ms-claim-token-0123456789": "admin@sellrika.local",
			};
			if (idToken && Object.hasOwn(unproved, idToken))
				return Response.json({
					users: [
						{
							localId: idToken,
							email: unproved[idToken],
							emailVerified: false,
							displayName: "Mia Microsoft",
						},
					],
				});
			if (idToken && Object.hasOwn(staff, idToken))
				return Response.json({
					users: [
						{ localId: idToken, email: staff[idToken], emailVerified: true },
					],
				});
			if (idToken !== "e2e-token-0123456789abcdef")
				return Response.json(
					{ error: { message: "INVALID_ID_TOKEN" } },
					{ status: 400 },
				);
			return Response.json({
				users: [
					{
						localId: "e2e-uid",
						email: "ann@example.com",
						emailVerified: true,
						displayName: "Ann Shopper",
					},
				],
			});
		}
		const file = Bun.file(`${root}${path}`);
		return (await file.exists()) && !path.includes("..")
			? new Response(file)
			: new Response("Not found", { status: 404 });
	},
});
