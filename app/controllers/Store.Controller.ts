import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import type { Paged } from "@xcore/http/Paginate";
import { RateLimit } from "@xcore/http/RateLimit";
import { HttpRequest, Query } from "@xcore/http/Request";
import { HttpResponse, json } from "@xcore/http/Response";
import { Url } from "@xcore/http/Url";
import { t } from "@xcore/i18n/I18n";
import { Inertia, redirect } from "@xcore/view/Inertia";
import { normalizeReference } from "@helpers/crypto";
import { RATE_LIMITS } from "@constants/Security.Constant";
import { CategoryService } from "@services/catalog/Category.Service";
import { StoreService, type StoreProduct } from "@services/sales/Store.Service";
import { MarketingService } from "@services/sales/marketing/Marketing.Service";
import { STORE_PER_PAGE } from "@constants/Pagination.Constant";
import { StorePageRepository } from "@repositories/StorePage.Repository";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import { formatMoney } from "@helpers/currency";
import { productFeed } from "@helpers/feed";
import { llmsTxt } from "@helpers/llms";
import type { HostedPayment } from "@services/settings/extensions/types/Extension.Payments.Types";
import {
	StoreAddressQuery,
	StoreCheckoutInput,
	StorePickupCheckoutInput,
	StoreCouponInput,
	StorePayInput,
	StoreSendInput,
	TrackInput,
} from "@validators/Store.Validator";
import { STORE_SORTS, type StoreSort } from "@constants/Store.Constant";
import { SEO_CACHE_CONTROL } from "@constants/Http.Constant";
import { API_PREFIX } from "@constants/Api.Constant";
import { Hooks } from "@xcore/hooks/Hooks";
import { COUNTRIES } from "@constants/Country.Constant";
import {
	type PubOrder,
	StoreViewService,
	type Storefront,
} from "@services/sales/StoreView.Service";
import { validate } from "@validators/validate";
import type { Shop } from "@models/Shop";
import { couponErrors } from "@controllers/support/couponErrors";
import { StorefrontSupport } from "@controllers/support/Storefront.Support";

/**
 * The public storefront: catalog, product and custom pages,
 * checkout, the thank-you page, order tracking and the email links.
 */
@Service()
export class StoreController {
	constructor(
		private site: StorefrontSupport,
		private store: StoreService,
		private categories: CategoryService,
		private pages: StorePageRepository,
		private extensions: ExtensionService,
		private marketing: MarketingService,
		private view: StoreViewService,
	) {}

	/**
	 * The catalog page, reached at "/" of the store's host.
	 * Paging and filters live in the URL, so pages are linkable
	 * and crawlable: `?q=`, `?category=`, `?page=`, `?sort=`, `?stock=1`.
	 * @param req The current request.
	 * @param s The resolved storefront.
	 * @returns The theme's catalog page with its SEO head.
	 */
	async catalog(req: Request, s: Storefront) {
		const q = new Query(req);
		const filters = {
			q: q.text("q"),
			category: Number(q.raw("category")) || null,
			sort: q.oneOf("sort", STORE_SORTS, "featured"),
			stock: q.raw("stock") === "1",
		};
		const { catalog, counts, featured } = await this.store.browse(s.shop.id, {
			...filters,
			page: Math.floor(Number(q.raw("page"))) || 1,
			// only a theme that asks for them gets the shop's picks
			featured: s.theme.featured,
		});
		const home = s.base || "/";
		const categories = await this.#tiles(s.shop.id, counts);
		return this.view.render(
			s,
			"home",
			{
				catalog,
				counts,
				featured,
				filters,
				categories,
				sorts: STORE_SORTS.map((value) => this.#sortOption(value)),
				pager: this.#pagerOf(catalog, (page) =>
					StoreViewService.catalogUrl(home, { ...filters, page }),
				),
			},
			this.#catalogSeo(s.shop, s.url, catalog, filters.q),
		);
	}

	/**
	 * GET /pages/:page — a custom page the merchant built
	 * in /online-store.
	 * @param req The current request.
	 * @returns The theme's custom page, or the not-found page.
	 */
	async page(req: BunRequest<"/pages/:page">) {
		const s = await this.site.open(req);
		if (s instanceof Response) return s;
		const page = await this.pages.findBySlug(s.shop.id, req.params.page);
		if (!page) return this.view.notFound(req, s);
		const url = `${s.url}/pages/${page.slug}`;
		return this.view.render(
			s,
			"page",
			{
				title: page.title,
				body: page.body,
				// printed inside <style>: a "</style" in it must not end the tag
				css: page.css.replace(/<\/style/gi, "<\\/style"),
				// the shop's own page leads back to the shop
				back: null,
			},
			StoreViewService.storeSeo(s.shop, {
				url,
				title: `${page.title} · ${s.shop.name}`,
				desc:
					StorefrontSupport.summary(page.body) ||
					`${page.title} — ${s.shop.name}`,
			}),
		);
	}

	/**
	 * GET /p/:product — a product's own page.
	 * It is what Google indexes and what a shared link opens.
	 * @param req The current request.
	 * @returns The theme's product page, or the not-found page.
	 */
	async product(req: BunRequest<"/p/:product">) {
		const s = await this.site.open(req);
		if (s instanceof Response) return s;
		const all = await this.store.catalog(s.shop.id);
		const slug = req.params.product;
		const product = all.find((p) => p.slug === slug);
		if (!product) return this.view.notFound(req, s);
		return this.view.render(
			s,
			"product",
			{
				product,
				related: this.store.related(all, product),
				gallery: this.#galleryOf(product),
				range: this.#rangeOf(product),
			},
			this.#productSeo(s.shop, s.url, product),
		);
	}

	/**
	 * GET /sitemap.xml — the pages search engines should read.
	 * On a store's host: its store, catalog pages, product pages,
	 * custom pages and the pages its extensions bring.
	 * On the main host: the app's own public pages (front page,
	 * pricing, legal pages) and no shops.
	 * Each shop submits its own file in Search Console.
	 * @param req The current request.
	 * @returns The XML document.
	 */
	async sitemap(req: BunRequest<"/sitemap.xml">) {
		const s = await this.site.find(req);
		if (s) {
			const products = await this.store.catalog(s.shop.id);
			const urls = [s.url];
			// the catalog pages past the first
			for (let n = 2; n <= Math.ceil(products.length / STORE_PER_PAGE); n++)
				urls.push(`${s.url}?page=${n}`);
			for (const p of products) urls.push(this.#productUrl(s.url, p));
			for (const p of await this.pages.links(s.shop.id))
				urls.push(`${s.url}/pages/${p.slug}`);
			// the pages its extensions bring (a blog's posts)
			for (const path of await this.extensions.storePaths(s.shop))
				urls.push(s.url + path);
			return this.#urlset(urls);
		}
		const origin = Url.originOf(req);
		return this.#urlset(Hooks.sitePaths.map((path) => origin + path));
	}

	/**
	 * GET /feed.xml — the shop's products as a product feed.
	 * Google Merchant Center, Facebook / Instagram and TikTok read it
	 * to show the products in their own shopping places.
	 * Only on a store's host.
	 * @param req The current request.
	 * @returns The XML document, or the not-found answer.
	 */
	async feed(req: BunRequest<"/feed.xml">) {
		const s = await this.site.open(req);
		if (s instanceof Response) return s;
		const products = [];
		for (const p of await this.store.catalog(s.shop.id))
			products.push({ ...p, brand: this.#brandOf(p) });
		return this.#xml(
			productFeed(
				{ name: s.shop.name, url: s.url, currency: s.shop.currency },
				products,
			),
		);
	}

	/**
	 * GET /llms.txt — the store as Markdown, for AI search tools.
	 * The shop, its products with price and stock, its custom pages.
	 * Only on a store's host. A closed host (a demo) answers not found.
	 * @param req The current request.
	 * @returns The Markdown text, or the not-found answer.
	 */
	async llms(req: BunRequest<"/llms.txt">) {
		if (Hooks.closedHosts.includes(Url.hostOf(req)))
			return Inertia.notFound(req);
		const s = await this.site.open(req);
		if (s instanceof Response) return s;
		const text = llmsTxt(
			{
				name: s.shop.name,
				url: s.url,
				currency: s.shop.currency,
				description: t("store_server.seo_shop_desc", { name: s.shop.name }),
			},
			await this.store.catalog(s.shop.id),
			await this.pages.links(s.shop.id),
		);
		return new Response(text, {
			headers: {
				"Content-Type": "text/markdown; charset=utf-8",
				"Cache-Control": SEO_CACHE_CONTROL,
			},
		});
	}

	/**
	 * GET /robots.txt — crawl the store, skip the personal and
	 * transactional pages, find the sitemap.
	 * A host in `Hooks.closedHosts` (a demo store) is closed to every
	 * crawler: it is a sample, not a real shop.
	 * @param req The current request.
	 * @returns The robots.txt body.
	 */
	async robots(req: BunRequest<"/robots.txt">) {
		const origin = (await this.site.isStore(req))
			? Url.requestOrigin(req)
			: Url.originOf(req);
		const demo = Hooks.closedHosts.includes(Url.hostOf(req));
		const lines = demo
			? ["User-agent: *", "Disallow: /"]
			: [
					"User-agent: *",
					"Allow: /",
					"Disallow: /login",
					"Disallow: /checkout",
					"Disallow: /done",
					"Disallow: /track",
					"Disallow: /account",
					`Disallow: ${API_PREFIX}`,
					`Sitemap: ${origin}/sitemap.xml`,
				];
		return new Response(`${lines.join("\n")}\n`, {
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Cache-Control": SEO_CACHE_CONTROL,
			},
		});
	}

	/**
	 * GET /checkout — who is buying and where it goes.
	 * The cart itself lives in the browser.
	 * @param req The current request.
	 * @returns The theme's checkout page (noindex), or the not-found page.
	 */
	async checkoutPage(req: BunRequest<"/checkout">) {
		const s = await this.site.open(req);
		if (s instanceof Response) return s;
		return this.#renderCheckout(s, null);
	}

	/**
	 * JSON: GET /address?country=&state=&q= — the guided address.
	 * It gives a country's states, and a state's cities with their
	 * postal code (see `StoreService.address`).
	 * Empty lists = no downloaded data for that country.
	 * `more` = the state holds cities beyond the first page:
	 * type to find them.
	 * @param req The current request.
	 * @returns `{ states, cities, more }`.
	 */
	async address(req: BunRequest<"/address">) {
		const s = await this.site.find(req);
		if (!s) return json({ states: [], cities: [], more: false }, 404);
		const v = validate(
			StoreAddressQuery,
			Object.fromEntries(new URL(req.url).searchParams),
		);
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		return json(
			await this.store.address(
				v.data.country || s.shop.country || "",
				v.data.state,
				v.data.q,
			),
		);
	}

	/**
	 * JSON: POST /checkout — price the cart and start the payment.
	 * @param req The current request.
	 * @returns `{ url }` (hosted page), `{ tokenize }` (the provider's
	 *   own form in the browser), or `{ errors }`.
	 */
	async checkout(req: BunRequest<"/checkout">) {
		const s = await this.site.openJson(req, "cart");
		if (s instanceof Response) return s;
		const raw = this.#accountEmail(s, await HttpRequest.body(req));
		// collecting in store needs no address, but only when the shop
		// offers it; else the delivery rules apply as usual
		const v = validate(
			s.shop.pickup && (raw as { pickup?: unknown })?.pickup === true
				? StorePickupCheckoutInput
				: StoreCheckoutInput,
			raw,
		);
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		// only an unpaid order (manual option) takes from the small budget
		const manualKey = this.#manualKey(req);
		if (v.data.payment) {
			const refused = this.#manualTaken(manualKey);
			if (refused) return refused;
		}
		// a signed-in customer owns the order
		const r = await this.store.checkout(
			s.shop,
			v.data,
			s.url,
			s.customer?.id ?? null,
		);
		// no order was written
		if (r.errors && v.data.payment) RateLimit.refund(manualKey);
		if (r.errors) return HttpResponse.unprocessable(r.errors);
		return json(r.tokenize ? { tokenize: r.tokenize } : { url: r.url });
	}

	/**
	 * JSON: POST /checkout/send — "Send order" in the cart of a store
	 * with no payment option.
	 * The order is written unpaid at once, with nothing asked.
	 * It shares the small budget of the other unpaid orders.
	 * @param req The current request.
	 * @returns `{ url }` of the thank-you page, or `{ errors }`.
	 */
	async send(req: BunRequest<"/checkout/send">) {
		const s = await this.site.openJson(req, "cart");
		if (s instanceof Response) return s;
		const v = validate(StoreSendInput, await HttpRequest.body(req));
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		const key = this.#manualKey(req);
		const refused = this.#manualTaken(key);
		if (refused) return refused;
		const r = await this.store.send(
			s.shop,
			v.data,
			s.url,
			s.customer?.id ?? null,
		);
		if (r.errors) {
			// no order was written
			RateLimit.refund(key);
			return HttpResponse.unprocessable(r.errors);
		}
		return json({ url: r.url });
	}

	/**
	 * JSON: POST /checkout/coupon — "Apply" a discount code.
	 * It prices the cart and says what the code takes off.
	 * @param req The current request.
	 * @returns `{ quote }`, or 422 `{ errors: { coupon } }`.
	 */
	async coupon(req: BunRequest<"/checkout/coupon">) {
		const s = await this.site.openJson(req, "coupon");
		if (s instanceof Response) return s;
		const v = validate(
			StoreCouponInput,
			this.#accountEmail(s, await HttpRequest.body(req)),
		);
		if (v.errors)
			return HttpResponse.unprocessable(
				couponErrors(v.errors, "store.code_invalid"),
			);
		const r = await this.store.quote(s.shop, v.data, s.customer?.id ?? null);
		return r.errors
			? HttpResponse.unprocessable(r.errors)
			: json({ quote: r.quote });
	}

	/**
	 * JSON: POST /checkout/pay — charge the nonce the gateway's form
	 * made (Omise).
	 * @param req The current request.
	 * @returns `{ url, qr }`, or 422 `{ errors }`.
	 */
	async pay(req: BunRequest<"/checkout/pay">) {
		const s = await this.site.openJson(req, "cart");
		if (s instanceof Response) return s;
		const v = validate(StorePayInput, await HttpRequest.body(req));
		if (v.errors)
			return HttpResponse.unprocessable({
				cart: v.errors.token ?? v.errors.ref!,
			});
		const r = await this.store.pay(s.shop, v.data.ref, v.data.token, s.url);
		return r.errors
			? HttpResponse.unprocessable(r.errors)
			: json({ url: r.url, qr: r.qr ?? null });
	}

	/**
	 * GET /done?sid=… — back from the gateway.
	 * It verifies the payment, creates the order once and says thanks.
	 * A QR payment (PromptPay…) never redirects anywhere.
	 * So the buyer lands here with the code still to scan.
	 * @param req The current request.
	 * @returns The theme's done page (noindex), or the not-found page.
	 */
	async done(req: BunRequest<"/done">) {
		const s = await this.site.open(req);
		if (s instanceof Response) return s;
		const url = new URL(req.url);
		// some gateways append their own id, not our ?sid=
		// the extension picks it out
		const sid =
			url.searchParams.get("sid") || (await this.#returnId(s.shop, url, null));
		if (!sid) return this.view.notFound(req, s);
		const r = await this.store.fulfill(s.shop, sid);
		if (r.error) return this.view.notFound(req, s);
		// bank details for an unpaid order
		const instructions = r.order
			? await this.store.paymentInstructions(s.shop, r.order)
			: null;
		const props = {
			order: r.order ? StoreViewService.pubOrder(r.order) : null,
			instructions,
			pending: !!r.pending,
			qr: r.qr ?? null,
			failed: !!r.failed,
			reason: r.reason ?? null,
		};
		// the island polls this page with fetch while a payment is pending
		if (req.headers.get("accept")?.includes("application/json"))
			return json(props);
		// personal receipt page: keep it out of search indexes
		return this.view.render(
			s,
			"done",
			props,
			this.site.privateSeo(
				s,
				"",
				t("store_server.seo_thanks_title", { name: s.shop.name }),
				t("store_server.seo_shop_desc", { name: s.shop.name }),
			),
		);
	}

	/**
	 * GET /track?code= — "where is my order": the form.
	 * The order code is prefilled from the confirmation email's link.
	 * The contact is still to type.
	 * @param req The current request.
	 * @returns The theme's track page (noindex), or the not-found page.
	 */
	async trackPage(req: BunRequest<"/track">) {
		const s = await this.site.open(req);
		if (s instanceof Response) return s;
		const code = normalizeReference(new Query(req).raw("code") ?? "") ?? "";
		return this.#renderTrack(s, { code, contact: "" }, null, null);
	}

	/**
	 * POST /track — look the order up.
	 * The buyer's email or phone is the proof it's theirs.
	 * It renders the same page with the order, or a single
	 * "not found" line. It never says which half was wrong.
	 * @param req The current request.
	 * @returns The theme's track page (noindex), or the not-found page.
	 */
	async track(req: BunRequest<"/track">) {
		const s = await this.site.open(req);
		if (s instanceof Response) return s;
		const raw = (await HttpRequest.body(req)) as {
			code?: unknown;
			contact?: unknown;
		} | null;
		const query = {
			code: String(raw?.code ?? ""),
			contact: String(raw?.contact ?? ""),
		};
		const v = validate(TrackInput, raw);
		if (v.errors)
			return this.#renderTrack(
				s,
				query,
				null,
				v.errors.code ?? v.errors.contact ?? t("store_server.check_details"),
			);
		const order = await this.store.track(s.shop, v.data.code, v.data.contact);
		if (!order)
			return this.#renderTrack(
				s,
				query,
				null,
				t("store_server.order_not_found"),
			);
		return this.#renderTrack(
			s,
			query,
			{
				...StoreViewService.pubOrder(order),
				instructions: await this.store.paymentInstructions(s.shop, order),
			},
			null,
		);
	}

	/**
	 * GET /cart/:token — the "Complete your order" link of the
	 * abandoned-cart email.
	 * It renders the checkout with the cart's lines.
	 * The page puts them back into the browser's cart.
	 * Nothing changes on the server.
	 * @param req The current request.
	 * @returns The theme's checkout page (noindex), the store for an
	 *   unknown link, or not found.
	 */
	async restoreCart(req: BunRequest<"/cart/:token">) {
		const s = await this.site.open(req);
		if (s instanceof Response) return s;
		const lines = await this.marketing.restore(s.shop.id, req.params.token);
		if (!lines) return redirect(s.base || "/");
		return this.#renderCheckout(s, lines);
	}

	/**
	 * GET /unsubscribe/:token — "Unsubscribe from <shop> emails?".
	 * It only asks. The button POSTs.
	 * @param req The current request.
	 * @returns The theme's unsubscribe page (noindex), or not found.
	 */
	async unsubscribePage(req: BunRequest<"/unsubscribe/:token">) {
		const s = await this.site.open(req);
		if (s instanceof Response) return s;
		const email = this.marketing.unsubscribeEmail(s.shop.id, req.params.token);
		return this.#renderUnsubscribe(req, s, email, false);
	}

	/**
	 * POST /unsubscribe/:token — stop the shop's marketing emails
	 * to that address.
	 * Also the one-click POST of a mail app (RFC 8058).
	 * @param req The current request.
	 * @returns The theme's unsubscribe page saying it is done,
	 *   or not found.
	 */
	async unsubscribe(req: BunRequest<"/unsubscribe/:token">) {
		const s = await this.site.open(req);
		if (s instanceof Response) return s;
		const email = await this.marketing.unsubscribe(s.shop.id, req.params.token);
		return this.#renderUnsubscribe(req, s, email, !!email);
	}

	/**
	 * POST /done — a gateway that returns the buyer with a form POST
	 * lands here. It bounces to the GET, which does the real work.
	 * The posted data is only used as a lookup key.
	 * The payment is verified against the provider there.
	 * @param req The current request.
	 * @returns 303 to `/done?sid=…`, or the not-found page.
	 */
	async doneReturn(req: BunRequest<"/done">) {
		const s = await this.site.open(req);
		if (s instanceof Response) return s;
		const form = await HttpRequest.formOf(req);
		const url = new URL(req.url);
		const sid =
			url.searchParams.get("sid") || (await this.#returnId(s.shop, url, form));
		if (!sid) return Inertia.notFound(req);
		return redirect(`${s.url}/done?sid=${encodeURIComponent(sid)}`);
	}

	/**
	 * A product's own page.
	 * This is the URL search engines index and people share.
	 * @param storeUrl Absolute URL of the storefront.
	 * @param p The product as the storefront sees it.
	 * @returns The absolute URL.
	 */
	#productUrl(storeUrl: string, p: StoreProduct) {
		return `${storeUrl}/p/${p.slug}`;
	}

	/**
	 * Cents as a decimal number, for machines.
	 * @param cents The amount in cents.
	 * @returns For example "18.00".
	 */
	#decimal(cents: number) {
		return (cents / 100).toFixed(2);
	}

	/**
	 * schema.org Product (Google rich results).
	 * @param shop The selling shop.
	 * @param storeUrl Absolute URL of the storefront.
	 * @param p The product as the storefront sees it.
	 * @returns The Product node: one Offer, or an AggregateOffer
	 *   when the variants differ in price.
	 */
	#productLd(shop: Shop, storeUrl: string, p: StoreProduct) {
		const origin = new URL(storeUrl).origin;
		const url = this.#productUrl(storeUrl, p);
		const prices = p.variants.map((v) => v.price);
		const lo = prices.length ? Math.min(...prices) : p.price,
			hi = prices.length ? Math.max(...prices) : p.price;
		const availability = p.sold_out
			? "https://schema.org/OutOfStock"
			: "https://schema.org/InStock";
		const shipping = this.#shippingLd(shop, p.price);
		const brand = this.#brandOf(p);
		// same fallback as og:image: Google wants a picture on every product
		const images = p.images.length ? p.images : shop.logo ? [shop.logo] : [];
		const offers =
			lo !== hi
				? {
						"@type": "AggregateOffer",
						lowPrice: this.#decimal(lo),
						highPrice: this.#decimal(hi),
						offerCount: prices.length,
						priceCurrency: shop.currency,
						availability,
						url,
					}
				: {
						"@type": "Offer",
						price: this.#decimal(p.price),
						priceCurrency: shop.currency,
						availability,
						url,
						...(shipping.length && { shippingDetails: shipping }),
					};
		return {
			"@type": "Product",
			name: p.name,
			url,
			// rich text: JSON-LD wants plain
			...(p.description && {
				description: StorefrontSupport.summary(p.description),
			}),
			...(images.length && {
				image: images.map((i) => (i.startsWith("http") ? i : origin + i)),
			}),
			...(brand && { brand: { "@type": "Brand", name: brand } }),
			offers,
		};
	}

	/**
	 * The brand of a product, for Google's "global identifier".
	 * It is the "Additional data" row titled Brand (or Marke).
	 * @param p The product as the storefront sees it.
	 * @returns The brand name, or undefined when no row names one.
	 */
	#brandOf(p: StoreProduct) {
		for (const row of p.extra)
			if (/^(brand|marke)$/i.test(row.title.trim()) && row.value.trim())
				return row.value.trim();
		return undefined;
	}

	/**
	 * schema.org OfferShippingDetails from the shop's delivery zones.
	 * ponytail: whole-country zones only. A rest-of-world zone has no
	 * country to name, and state / city zones are left out.
	 * @param shop The selling shop.
	 * @param price The product's price in cents (for the free threshold).
	 * @returns One node per zone that names whole countries.
	 */
	#shippingLd(shop: Shop, price: number) {
		const nodes = [];
		for (const z of shop.delivery_zones) {
			if (!z.countries.length || z.states.length || z.cities.length) continue;
			const codes = [];
			for (const c of COUNTRIES)
				if (z.countries.includes(c.name)) codes.push(c.code);
			if (!codes.length) continue;
			const free = z.free_delivery_min !== null && price >= z.free_delivery_min;
			nodes.push({
				"@type": "OfferShippingDetails",
				shippingRate: {
					"@type": "MonetaryAmount",
					value: this.#decimal(free ? 0 : z.fee),
					currency: shop.currency,
				},
				shippingDestination: {
					"@type": "DefinedRegion",
					addressCountry: codes,
				},
			});
		}
		return nodes;
	}

	/**
	 * The ItemList of one catalog page (Google rich results).
	 * @param shop The selling shop.
	 * @param storeUrl Absolute URL of the storefront.
	 * @param catalog The page of products being rendered.
	 * @returns The ItemList node, or null for an empty page.
	 */
	#catalogLd(shop: Shop, storeUrl: string, catalog: Paged<StoreProduct>) {
		if (!catalog.data.length) return null;
		const first = (catalog.page - 1) * catalog.per_page + 1;
		const itemListElement = [];
		for (const [i, p] of catalog.data.entries())
			itemListElement.push({
				"@type": "ListItem",
				position: first + i,
				item: this.#productLd(shop, storeUrl, p),
			});
		return { "@type": "ItemList", itemListElement };
	}

	/**
	 * Who the shop is, for search engines and AI search tools.
	 * An OnlineStore node and a WebSite node with the store search.
	 * Only public store settings: the logo, the phone and the address
	 * the footer already shows. Never an email, a cost or a key.
	 * @param shop The selling shop.
	 * @param storeUrl Absolute URL of the storefront.
	 * @param desc The page's description.
	 * @returns The two nodes.
	 */
	#shopLd(shop: Shop, storeUrl: string, desc: string) {
		const origin = new URL(storeUrl).origin;
		const logo = shop.logo
			? shop.logo.startsWith("http")
				? shop.logo
				: origin + shop.logo
			: null;
		const store = {
			"@type": "OnlineStore",
			"@id": `${storeUrl}/#store`,
			name: shop.name,
			url: storeUrl,
			description: desc,
			...(logo && { logo }),
			...(shop.phone && { telephone: shop.phone }),
			...(shop.address && { address: shop.address }),
		};
		const site = {
			"@type": "WebSite",
			"@id": `${storeUrl}/#website`,
			name: shop.name,
			url: storeUrl,
			publisher: { "@id": store["@id"] },
			// the catalog at "/" filters by ?q=
			potentialAction: {
				"@type": "SearchAction",
				target: `${storeUrl}/?q={search_term_string}`,
				"query-input": "required name=search_term_string",
			},
		};
		return [store, site];
	}

	/**
	 * The path from the store's home to a product (Google breadcrumbs).
	 * ponytail: Home › Product. A category has no page of its own:
	 * `?category=` points its canonical at the home page.
	 * @param shop The selling shop.
	 * @param storeUrl Absolute URL of the storefront.
	 * @param p The product as the storefront sees it.
	 * @returns The BreadcrumbList node.
	 */
	#breadcrumbLd(shop: Shop, storeUrl: string, p: StoreProduct) {
		return {
			"@type": "BreadcrumbList",
			itemListElement: [
				{ "@type": "ListItem", position: 1, name: shop.name, item: storeUrl },
				{
					"@type": "ListItem",
					position: 2,
					name: p.name,
					item: this.#productUrl(storeUrl, p),
				},
			],
		};
	}

	/**
	 * Head for one catalog page.
	 * The description names the first products.
	 * The JSON-LD is an ItemList of that page's products.
	 * The first page also says who the shop is (`#shopLd`).
	 * The canonical link carries `?page=N` past the first page.
	 * @param shop The selling shop.
	 * @param storeUrl Absolute URL of the storefront.
	 * @param catalog The page of products being rendered.
	 * @param q The active search text. A search result page is `noindex`.
	 * @returns The head data.
	 */
	#catalogSeo(
		shop: Shop,
		storeUrl: string,
		catalog: Paged<StoreProduct>,
		q: string,
	) {
		const desc = catalog.total
			? t("store_server.seo_catalog_desc", {
					name: shop.name,
					total: catalog.total,
					products: catalog.data
						.slice(0, 5)
						.map((p) => p.name)
						.join(", "),
				})
			: t("store_server.seo_shop_desc", { name: shop.name });
		const graph: object[] =
			catalog.page > 1 ? [] : this.#shopLd(shop, storeUrl, desc);
		const list = this.#catalogLd(shop, storeUrl, catalog);
		if (list) graph.push(list);
		return StoreViewService.storeSeo(shop, {
			url: catalog.page > 1 ? `${storeUrl}?page=${catalog.page}` : storeUrl,
			title:
				catalog.page > 1
					? t("store_server.seo_page_n", {
							name: shop.name,
							page: catalog.page,
						})
					: shop.name,
			desc,
			noindex: !!q,
			ld: graph.length
				? { "@context": "https://schema.org", "@graph": graph }
				: undefined,
		});
	}

	/**
	 * Head for a product page.
	 * It has og:type product and the price tags Facebook and Pinterest read.
	 * It also has the Product and the BreadcrumbList JSON-LD.
	 * @param shop The selling shop.
	 * @param storeUrl Absolute URL of the storefront.
	 * @param p The product as the storefront sees it.
	 * @returns The head data.
	 */
	#productSeo(shop: Shop, storeUrl: string, p: StoreProduct) {
		return StoreViewService.storeSeo(shop, {
			url: this.#productUrl(storeUrl, p),
			title: `${p.name} · ${shop.name}`,
			desc:
				StorefrontSupport.summary(p.description) ||
				t("store_server.seo_product_desc", {
					product: p.name,
					price: formatMoney(p.price, shop.currency, "en"),
					name: shop.name,
				}),
			image: p.images[0],
			type: "product",
			meta: [
				{ property: "product:price:amount", content: this.#decimal(p.price) },
				{ property: "product:price:currency", content: shop.currency },
			],
			ld: {
				"@context": "https://schema.org",
				"@graph": [
					this.#productLd(shop, storeUrl, p),
					this.#breadcrumbLd(shop, storeUrl, p),
				],
			},
		});
	}

	/**
	 * The pages of a catalog for the pager.
	 * ponytail: lists every page; window it if a shop has hundreds.
	 * @param catalog The page being shown.
	 * @param link Builds the link of page n.
	 * @returns `{ prev, next, pages[{ n, url, current }] }`.
	 *   Null = no such page.
	 */
	#pagerOf(catalog: Paged<StoreProduct>, link: (n: number) => string) {
		const pages = [];
		for (let n = 1; n <= catalog.last_page; n++)
			pages.push({ n, url: link(n), current: n === catalog.page });
		return {
			prev: catalog.page > 1 ? link(catalog.page - 1) : null,
			next: catalog.page < catalog.last_page ? link(catalog.page + 1) : null,
			pages,
		};
	}

	/**
	 * Every address of a variant or product for a gallery, each once.
	 * @param p The product.
	 * @returns Its images, then each variant's.
	 */
	#galleryOf(p: StoreProduct): string[] {
		return [...new Set([...p.images, ...p.variants.flatMap((v) => v.images)])];
	}

	/**
	 * The lowest and highest variant price, when they differ.
	 * @param p The product.
	 * @returns `{ min, max }`, or null for one price.
	 */
	#rangeOf(p: StoreProduct) {
		const prices = p.variants.map((v) => v.price);
		if (prices.length < 2) return null;
		const min = Math.min(...prices);
		const max = Math.max(...prices);
		return min === max ? null : { min, max };
	}

	/**
	 * One choice of the catalog's sort box.
	 * @param value The sort's key.
	 * @returns `{ value, label }`, the label in the request's language.
	 */
	#sortOption(value: StoreSort) {
		return { value, label: t(`store.sort_${value}`) };
	}

	/**
	 * One address as a sitemap entry.
	 * @param url The absolute URL.
	 * @returns The `<url>` tag.
	 */
	#urlTag(url: string) {
		return `<url><loc>${StorefrontSupport.esc(url)}</loc></url>`;
	}

	/**
	 * The provider's own payment id.
	 * A provider may bring the buyer back to /done without our `?sid=`.
	 * PayPal appends `?token=`, 2C2P posts a JWT.
	 * The gateway extension reads it.
	 * @param shop The selling shop.
	 * @param url The return URL.
	 * @param form The posted form, or null.
	 * @returns That id, or null.
	 */
	async #returnId(
		shop: Shop,
		url: URL,
		form: FormData | null,
	): Promise<string | null> {
		const p = (await this.extensions.onlinePayment(shop.id))?.payment as
			| HostedPayment
			| undefined;
		return p?.returnId?.(url, form) || null;
	}

	/**
	 * The categories that have a product, for the catalog's filter.
	 * @param shopId The selling shop.
	 * @param counts Products per category id.
	 * @returns `{ id, name, color, count }` per category.
	 */
	async #tiles(shopId: number, counts: Record<number, number>) {
		const tiles = [];
		for (const c of await this.categories.list(shopId)) {
			if (!counts[c.id]) continue;
			tiles.push({
				id: c.id,
				name: c.name,
				color: c.color,
				count: counts[c.id] ?? 0,
			});
		}
		return tiles;
	}

	/**
	 * An XML document as a response.
	 * @param content The document, without its `<?xml?>` line.
	 * @returns The response.
	 */
	#xml(content: string) {
		return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${content}`, {
			headers: {
				"Content-Type": "application/xml; charset=utf-8",
				"Cache-Control": SEO_CACHE_CONTROL,
			},
		});
	}

	/**
	 * A sitemap of some addresses.
	 * @param urls The absolute URLs.
	 * @returns The XML response.
	 */
	#urlset(urls: string[]) {
		const open = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
		return this.#xml(
			`${open}\n${urls.map((url) => this.#urlTag(url)).join("\n")}\n</urlset>`,
		);
	}

	/**
	 * The checkout page.
	 * It is a personal page, kept out of search indexes.
	 * The shop's own states go along, so the first paint already shows
	 * the guided address when the list is there and the shop wants lists.
	 * @param s The resolved storefront.
	 * @param restore The cart lines of an abandoned-cart link, or null.
	 * @returns The theme's checkout page (noindex).
	 */
	async #renderCheckout(s: Storefront, restore: unknown) {
		return this.view.render(
			s,
			"checkout",
			{ states: await this.site.states(s), restore },
			this.site.privateSeo(
				s,
				"/checkout",
				t("store_server.seo_checkout_title", { name: s.shop.name }),
				t("store_server.seo_checkout_desc", { name: s.shop.name }),
			),
		);
	}

	/**
	 * A signed-in customer always checks out with their account's email.
	 * The box is read-only on the page.
	 * This makes sure a changed request can't use another email.
	 * The email is used for the order confirmation, customer-only codes
	 * and per-customer code limits.
	 * @param s The storefront, with the signed-in customer if any.
	 * @param raw The request body.
	 * @returns The body, with the email set to the account's email when
	 *   signed in: `customer.email` on a checkout, `email` on a coupon
	 *   check.
	 */
	#accountEmail(s: Storefront, raw: unknown): unknown {
		const email = s.customer?.email;
		if (!email || !raw || typeof raw !== "object") return raw;
		const body = raw as { customer?: unknown };
		if (body.customer && typeof body.customer === "object")
			return { ...body, customer: { ...body.customer, email } };
		return { ...body, email };
	}

	/**
	 * The rate-limit key of the unpaid orders of one visitor.
	 * An unpaid order needs no payment at all,
	 * so it has its own, much smaller budget.
	 * @param req The current request.
	 * @returns The key.
	 */
	#manualKey(req: Request) {
		return `storeManualOrder:${Url.clientIp(req)}`;
	}

	/**
	 * Take one unpaid order from the visitor's budget.
	 * @param key The visitor's key, from `manualKey`.
	 * @returns Null when there was room, else the 429 answer.
	 */
	#manualTaken(key: string): Response | null {
		const rule = RATE_LIMITS.storeManualOrder;
		if (RateLimit.take(key, rule.limit, rule.windowMs).allowed) return null;
		return json({ errors: { cart: t(rule.message) } }, 429);
	}

	/**
	 * Shared body of `trackPage` / `track`.
	 * @param s The resolved storefront.
	 * @param query What the buyer typed (echoed back into the form).
	 * @param order The order found, or null.
	 * @param error One line for the form, or null.
	 * @returns The theme's track page (noindex).
	 */
	async #renderTrack(
		s: Storefront,
		query: { code: string; contact: string },
		order: (PubOrder & { instructions: string | null }) | null,
		error: string | null,
	) {
		return this.view.render(
			s,
			"track",
			{ query, order, error },
			this.site.privateSeo(
				s,
				"/track",
				t("store_server.seo_track_title", { name: s.shop.name }),
				t("store_server.seo_track_desc", { name: s.shop.name }),
			),
		);
	}

	/**
	 * Shared body of `unsubscribePage` / `unsubscribe`.
	 * @param req The current request.
	 * @param s The resolved storefront.
	 * @param email The address of the link, or null when it is broken.
	 * @param done True once the address is unsubscribed.
	 * @returns The theme's unsubscribe page (noindex).
	 */
	async #renderUnsubscribe(
		req: Request,
		s: Storefront,
		email: string | null,
		done: boolean,
	) {
		const title = t("marketing.unsubscribe_title", { shop: s.shop.name });
		return this.view.render(
			s,
			"unsubscribe",
			{ email, done, action: new URL(req.url).pathname },
			this.site.privateSeo(s, "/unsubscribe", title, title),
		);
	}
}
