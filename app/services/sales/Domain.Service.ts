// node:fs/promises + node:path:
// Bun has no rename, directory check or dirname of its own
import { rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
// node:dns/promises: Bun.dns.lookup only gives A/AAAA addresses, never TXT records
import { resolveTxt } from "node:dns/promises";
import { Service } from "@xcore/di";
import { app } from "@config/app";
import { ShopRepository } from "@repositories/Shop.Repository";
import {
	DOMAIN_CHECK_BATCH,
	DOMAIN_TXT_LABEL,
	TRAEFIK,
	type DomainStatus,
} from "@constants/Domain.Constant";
import { domainToken } from "@helpers/crypto";

/**
 * What the Online store page shows about the custom domain.
 * `null` from `DomainService.info` = nobody manages domains here.
 */
export type DomainSetup = {
	/**
	 * Where the domain stands now.
	 */
	status: DomainStatus;
	/**
	 * The host a subdomain's CNAME points at.
	 */
	cname: string;
	/**
	 * The IPv4 addresses a root domain's A record points at.
	 */
	ips: string[];
	/**
	 * What the domain points at now.
	 * [] = nothing, or it could not be looked up.
	 */
	found: string[];
	/**
	 * The TXT record that proves the shop owns the domain.
	 */
	txt: { name: string; value: string };
};

/**
 * Custom store domains behind Traefik.
 * The shops table is the one list of domains.
 * The Traefik file is only a copy of it, written again on every run.
 * So it never needs a backup.
 */
@Service()
export class DomainService {
	constructor(private shops: ShopRepository) {}

	/**
	 * Does this server route and certify custom domains itself?
	 * @returns True when `DOMAIN_CNAME` is set.
	 */
	managed(): boolean {
		return !!app.domains.cname;
	}

	/**
	 * The addresses a hostname resolves to.
	 * @param host The hostname.
	 * @returns The addresses, or null when the lookup failed.
	 */
	async lookup(host: string): Promise<string[] | null> {
		try {
			return (await Bun.dns.lookup(host)).map((a) => a.address);
		} catch {
			return null;
		}
	}

	/**
	 * The TXT values at a hostname.
	 * @param host The hostname.
	 * @returns Each record's text, or [] when there is none or the lookup failed.
	 */
	async txt(host: string): Promise<string[]> {
		try {
			return (await resolveTxt(host)).map((parts) => parts.join(""));
		} catch {
			return [];
		}
	}

	/**
	 * Has the shop proved it owns the domain, with its TXT record?
	 * @param shopId The shop.
	 * @param domain Its custom domain.
	 * @returns True when `_sellrika.<domain>` holds the shop's token.
	 */
	async owns(shopId: number, domain: string): Promise<boolean> {
		const found = await this.txt(`${DOMAIN_TXT_LABEL}.${domain}`);
		return found.includes(domainToken(shopId, domain));
	}

	/**
	 * The DNS records a merchant must add, and where their domain stands.
	 * @param shopId The shop.
	 * @param domain The shop's domain (null = none).
	 * @param status The shop's `domain_status`.
	 * @returns The setup, or null when nobody manages domains here.
	 */
	async info(
		shopId: number,
		domain: string | null,
		status: DomainStatus,
	): Promise<DomainSetup | null> {
		if (!this.managed()) return null;
		const ours = (await this.lookup(app.domains.cname)) ?? [];
		return {
			status,
			cname: app.domains.cname,
			ips: ours.filter((a) => !a.includes(":")),
			found:
				domain && status !== "live" ? ((await this.lookup(domain)) ?? []) : [],
			txt: {
				name: `${DOMAIN_TXT_LABEL}.${domain ?? ""}`,
				value: domain ? domainToken(shopId, domain) : "",
			},
		};
	}

	/**
	 * Check every shop's domain, save where it stands, and write the Traefik file,
	 * with every open store's free subdomain too.
	 * A domain goes live when it points here and its TXT record proves
	 * the shop owns it.
	 * A live domain stays live while it points here, without asking for the TXT again.
	 * One that moved away goes back to pending.
	 * A failed lookup keeps a live domain live.
	 * So a DNS hiccup never takes a store down.
	 * Custom domains are looked up `DOMAIN_CHECK_BATCH` at a time.
	 * The free addresses share one wildcard record.
	 * So once one of them points here, the rest are not looked up.
	 * @returns How many hostnames are routed now.
	 */
	async run(): Promise<number> {
		if (!this.managed()) return 0;
		const ours = await this.lookup(app.domains.cname);
		if (!ours?.length) {
			console.warn(`[domains] ${app.domains.cname} does not resolve`);
			return 0;
		}
		const hosts: string[] = [];
		const shops = await this.shops.withDomain();
		for (let i = 0; i < shops.length; i += DOMAIN_CHECK_BATCH) {
			const batch = shops.slice(i, i + DOMAIN_CHECK_BATCH);
			const routed = await Promise.all(
				batch.map((shop) => this.#check(shop, ours)),
			);
			hosts.push(...routed.flat());
		}
		// Every open store's free address `<slug>.<STORE_DOMAIN>`.
		// A wildcard DNS record points them here.
		// With a DNS-challenge resolver (`STORE_WILDCARD_RESOLVER`) one
		// router and one wildcard certificate serve them all.
		// Without it each open store gets its own certificate, and
		// Let's Encrypt allows 50 new ones a week for the whole domain.
		if (app.domains.wildcardResolver) {
			await this.#write(hosts, true);
			return hosts.length;
		}
		let wildcard = false;
		for (const shop of await this.shops.online()) {
			if (!shop.slug) continue;
			const host = `${shop.slug}.${app.domains.store}`;
			wildcard ||= await this.#resolvesHere(host, ours);
			if (wildcard) hosts.push(host);
		}
		await this.#write(hosts);
		return hosts.length;
	}

	/**
	 * Does a domain point at us?
	 * Every address must be ours: Let's Encrypt may try any of them.
	 * @param found The domain's addresses.
	 * @param ours The addresses of the CNAME target.
	 * @returns True when there is at least one and all are ours.
	 */
	static pointsHere(found: string[], ours: string[]): boolean {
		return found.length > 0 && found.every((a) => ours.includes(a));
	}

	/**
	 * The Traefik dynamic config for these hostnames.
	 * Each host gets its own router, so it gets its own certificate:
	 * a `www.` that fails can never block the main domain.
	 * With `wildcard`, one more router takes every name right under the
	 * store domain, on one wildcard certificate.
	 * So a new or renamed store needs no certificate of its own.
	 * The file brings its own two middlewares, and its own service when
	 * `service` is empty, so it needs nothing from the proxy's other files.
	 * @param hosts The hostnames to route, e.g. `example.com`, `www.example.com`.
	 * @param service The Traefik service that reaches this app.
	 *   Empty = our own service, pointing at `appUrl`.
	 * @param wildcard The store domain and the DNS-challenge resolver, or
	 *   nothing for no wildcard router.
	 * @param appUrl Where Traefik reaches this app, for our own service.
	 * @param names The proxy's entrypoints and certificate resolver.
	 * @returns The config object (written as JSON, which is valid YAML).
	 */
	static traefikConfig(
		hosts: string[],
		service: string,
		wildcard?: { domain: string; resolver: string },
		appUrl = app.domains.traefikAppUrl,
		names = app.domains.traefik,
	) {
		const target = service || TRAEFIK.service;
		const routers: Record<string, object> = {};
		/**
		 * Add the https router and the redirect router of one rule.
		 * @param name The https router's name.
		 * @param rule What the routers match.
		 * @param tls The https router's certificate settings.
		 */
		function add(name: string, rule: string, tls: object) {
			routers[name] = {
				rule,
				entryPoints: [names.https],
				middlewares: [TRAEFIK.gzip],
				service: target,
				tls,
			};
			routers[`${name}-http`] = {
				rule,
				entryPoints: [names.http],
				middlewares: [TRAEFIK.redirect],
				service: target,
			};
		}
		if (wildcard) {
			// one label right under the store domain: `<slug>.shop.example.com`
			const rule = `HostRegexp(\`^[a-z0-9-]+\\.${wildcard.domain.replaceAll(".", "\\.")}$\`)`;
			add(`${TRAEFIK.prefix}wildcard`, rule, {
				certResolver: wildcard.resolver,
				domains: [{ main: wildcard.domain, sans: [`*.${wildcard.domain}`] }],
			});
		}
		for (const host of hosts)
			add(TRAEFIK.prefix + host.replaceAll(".", "-"), `Host(\`${host}\`)`, {
				certResolver: names.certResolver,
			});
		const middlewares = {
			[TRAEFIK.redirect]: {
				redirectScheme: { scheme: "https", permanent: true },
			},
			[TRAEFIK.gzip]: { compress: {} },
		};
		// our own service only when no other one was named
		const services = service
			? undefined
			: { [TRAEFIK.service]: { loadBalancer: { servers: [{ url: appUrl }] } } };
		return { http: { routers, middlewares, ...(services && { services }) } };
	}

	/**
	 * Check one shop's custom domain and save where it stands.
	 * @param shop The shop's id, domain and saved status.
	 * @param ours The addresses of the CNAME target.
	 * @returns The hostnames to route: none, the domain, or it and its `www.`.
	 */
	async #check(
		shop: { id: number; domain: string; domain_status: DomainStatus },
		ours: string[],
	): Promise<string[]> {
		const found = await this.lookup(shop.domain);
		const was = shop.domain_status === "live";
		const live = found
			? DomainService.pointsHere(found, ours) &&
				(was || (await this.owns(shop.id, shop.domain)))
			: was;
		const status: DomainStatus = live ? "live" : "pending";
		if (status !== shop.domain_status)
			await this.shops.setDomainStatus(shop.id, status);
		if (!live) return [];
		const www = `www.${shop.domain}`;
		return (await this.#resolvesHere(www, ours))
			? [shop.domain, www]
			: [shop.domain];
	}

	/**
	 * Look a hostname up and see whether it points at us.
	 * @param host The hostname.
	 * @param ours The addresses of the CNAME target.
	 * @returns True when it resolves and every address is ours.
	 */
	async #resolvesHere(host: string, ours: string[]): Promise<boolean> {
		const found = await this.lookup(host);
		return !!found && DomainService.pointsHere(found, ours);
	}

	/**
	 * Write the Traefik file, only when it changed.
	 * Written to a hidden temp file first, then renamed.
	 * So Traefik never reads half a file
	 * (it skips files that don't end in .yaml / .yml / .toml).
	 * @param hosts The hostnames to route.
	 * @param wildcard True = also the one router for every free store address.
	 */
	async #write(hosts: string[], wildcard = false) {
		const file = app.domains.traefikFile;
		const dir = dirname(file);
		if (!(await stat(dir).catch(() => null))?.isDirectory()) {
			console.warn(
				`[domains] ${dir} is missing — mount the folder Traefik's file provider watches there`,
			);
			return;
		}
		const config = DomainService.traefikConfig(
			hosts,
			app.domains.traefikService,
			wildcard
				? { domain: app.domains.store, resolver: app.domains.wildcardResolver }
				: undefined,
		);
		const text = `${JSON.stringify(config, null, 2)}\n`;
		if (
			(await Bun.file(file)
				.text()
				.catch(() => "")) === text
		)
			return;
		const tmp = join(dir, ".sellrika-shops.tmp");
		await Bun.write(tmp, text);
		await rename(tmp, file);
	}
}
