import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import type { Mailer } from "@mail";
import type { Mailable } from "@emails/types";
import { MailerRegistry } from "@mail/Mailer.Registry";
import { Outbound } from "@xcore/http/Outbound";
import { SettingRepository } from "@repositories/Setting.Repository";
import { encrypt } from "@helpers/crypto";
import { messageOf } from "@helpers/error";
import { maskFields, openFields } from "@helpers/secretFields";
import type { MailInput } from "@validators/Mail.Validator";
import type { Errors } from "@validators/validate";
import { MAIL_SETTING_KEY, MAIL_SYSTEM_NAME } from "@constants/Mail.Constant";

/**
 * What is stored.
 * Which provider is switched on ("" = none), and the sender.
 * And *every* provider's credentials.
 * They all stay saved, so switching delivery over
 * doesn't mean typing them again.
 * The sender (`from_email`) is one whole address.
 * Every email through this setup goes out from it.
 * Some providers (Azure) send only from addresses set up there.
 * So there is no per-shop address.
 */
/**
 * A setup that can send right now:
 * the mailer, its decrypted credentials and the sender address.
 * `own` = a shop's own setup: a tenant picked the host it connects to.
 */
export type MailSetup = {
	mailer: Mailer;
	creds: Record<string, string>;
	from_email: string;
	own: boolean;
};

type StoredMail = {
	driver: string;
	from_email: string;
	credentials: Record<string, Record<string, string>>;
};

/**
 * Outgoing email.
 * One `settings` row holds the platform's setup (key `mail`).
 * A shop may have its own (key `mail:shop:<id>`).
 * Its customer emails go through it, else through the platform's.
 * Every method takes `shopId` for the shop's setup.
 * None = the platform's.
 */
@Service()
export class MailService {
	constructor(
		private settingsRepo: SettingRepository,
		private mailers: MailerRegistry,
	) {}

	/**
	 * Settings for the email page.
	 * Secret values are never sent back, only whether each is stored.
	 * @param shopId The shop; none = the platform.
	 * @returns Driver, sender, non-secret credentials and a `secret_set` map.
	 * And whether email works right now.
	 */
	async settings(shopId?: number) {
		const s = await this.#stored(shopId);
		const credentials: Record<string, Record<string, string>> = {};
		const secret_set: Record<string, Record<string, boolean>> = {};
		for (const m of this.mailers.all()) {
			const masked = maskFields(m.fields, s.credentials[m.key] ?? {});
			credentials[m.key] = masked.credentials;
			secret_set[m.key] = masked.secret_set;
		}
		return {
			driver: s.driver,
			from_email: s.from_email,
			credentials,
			secret_set,
			configured: !!(await this.config(shopId)),
		};
	}

	/**
	 * Whether a shop's email can go out.
	 * Through its own setup, else the platform's.
	 * @param shopId The shop.
	 * @returns True when one of the two works.
	 */
	async ready(shopId: number) {
		return !!(await this.setupFor(shopId));
	}

	/**
	 * The setup an email goes out through.
	 * A shop's own setup, else the platform's.
	 * A caller that sends many emails reads it once and hands it to `send`.
	 * @param shopId The shop; none = the platform.
	 * @returns The setup, or null while email is off.
	 */
	async setupFor(shopId?: number): Promise<MailSetup | null> {
		const own = shopId ? await this.config(shopId) : null;
		return own ?? (await this.config());
	}

	/**
	 * Forget a shop's own setup (the shop is deleted).
	 * @param shopId The shop.
	 */
	forget(shopId: number) {
		return this.settingsRepo.delete(this.#keyOf(shopId));
	}

	/**
	 * The address a shop's customer emails go out from
	 * through the platform's setup.
	 * @returns The platform's sender address.
	 * Null while the platform's email is off.
	 */
	async platformAddress() {
		return (await this.config())?.from_email ?? null;
	}

	/**
	 * Save the mail settings: every provider's credentials at once.
	 * `driver` = the one switched on ("" = outgoing email off).
	 * Only the switched-on provider has to be complete.
	 * A blank secret keeps the stored one.
	 * @param d Validated driver, sender and per-provider credentials.
	 * @param shopId The shop; none = the platform.
	 * @returns `{errors}` when something is wrong, `{}` when saved.
	 */
	async update(d: MailInput, shopId?: number): Promise<{ errors?: Errors }> {
		if (d.driver && !this.mailers.get(d.driver))
			return { errors: { driver: t("server.mail_unknown_provider") } };
		const s = await this.#stored(shopId);
		for (const m of this.mailers.all()) {
			const sent = d.credentials[m.key];
			const mine = s.credentials[m.key] ?? {};
			for (const f of m.fields) {
				const v = (sent?.[f.name] ?? "").trim();
				if (sent && f.secret) {
					if (v) {
						try {
							mine[f.name] = encrypt(v);
						} catch (e) {
							return {
								errors: {
									[`credentials.${m.key}.${f.name}`]: messageOf(
										e,
										t("server.mail_encrypt_failed"),
									),
								},
							};
						}
					} // blank = keep the stored one
				} else if (sent) mine[f.name] = v;
				// half-filled providers are fine while they are off
				// the one delivering must be complete
				if (m.key === d.driver && f.required && !mine[f.name])
					return {
						errors: {
							[`credentials.${m.key}.${f.name}`]: t(
								"server.mail_field_required",
								{ label: f.label },
							),
						},
					};
			}
			s.credentials[m.key] = mine;
		}
		if (d.driver && !d.from_email)
			return { errors: { from_email: t("server.mail_sender_required") } };
		await this.settingsRepo.set(
			this.#keyOf(shopId),
			JSON.stringify({
				driver: d.driver,
				from_email: d.from_email,
				credentials: s.credentials,
			}),
		);
		return {};
	}

	/**
	 * The ready-to-use setup of the provider that is switched on.
	 * @param shopId The shop; none = the platform.
	 * @returns The mailer, its decrypted credentials and the sender address.
	 * Null when email is off or incomplete.
	 * Null too when APP_KEY no longer decrypts the stored secrets.
	 */
	async config(shopId?: number): Promise<MailSetup | null> {
		const s = await this.#stored(shopId);
		const mailer = this.mailers.get(s.driver);
		if (!mailer || !s.from_email) return null;
		try {
			const creds = this.#credsFor(mailer, s.credentials);
			return (
				creds && {
					mailer,
					creds,
					from_email: s.from_email,
					own: !!shopId,
				}
			);
		} catch {
			// stored secrets unreadable: the admin has to enter them again
			return null;
		}
	}

	/**
	 * Send one email.
	 * A shop's email goes through the shop's own setup, from its address.
	 * Without one it goes through the platform's, from the platform's address.
	 * That is how the app's own email goes out too.
	 * The name is the shop's, else the app's own name.
	 * @param email The email: one of the classes in app/emails.
	 * @param setup The setup from `setupFor`, read once by a bulk sender.
	 * Left out = it is read now.
	 * A shop's own setup may only reach a public host,
	 * and its failure is told in fixed words:
	 * the server's reply could come from a host inside our network.
	 * @returns Null when it went out, else a reason a person may read.
	 * "Email is not set up yet" is one such reason.
	 * So callers (order confirmations…) can simply skip it.
	 */
	async send(
		email: Mailable,
		setup?: MailSetup | null,
	): Promise<string | null> {
		const shop = email.fromShop;
		const c = setup ?? (await this.setupFor(shop?.id));
		if (!c) return t("server.mail_not_set_up");
		if (c.own && !(await this.#reachable(c)))
			return t("server.mail_host_refused");
		try {
			await c.mailer.send(c.creds, {
				...(await email.build()),
				to: email.to,
				from: `${MailService.senderName(shop?.name ?? null)} <${c.from_email}>`,
			});
			return null;
		} catch (e) {
			if (c.own) {
				console.warn(`[mail] shop ${shop?.id} (${c.mailer.key}):`, e);
				return t("server.mail_shop_send_failed");
			}
			// a MailError is an Error too: both give their own message
			return messageOf(e, t("server.mail_send_failed"));
		}
	}

	/**
	 * May the server connect to the host of this setup?
	 * @param c The setup.
	 * @returns True for a mailer with a fixed host (Resend),
	 *   or when the typed host leads to public addresses only.
	 */
	async #reachable(c: MailSetup): Promise<boolean> {
		if (!c.mailer.host) return true;
		const host = c.mailer.host(c.creds);
		return !!host && Outbound.isPublicHost(host);
	}

	/**
	 * The display name for the From header.
	 * Control characters, quotes, backslashes and angle brackets are dropped.
	 * So the name can't break the header.
	 * A name with a comma, dot, @ or other RFC 5322 special gets double quotes.
	 * Without the quotes, `Smith, Sons & Co.` would read as two addresses.
	 * @param name The email's sender name; null or empty = the app's own name.
	 * @returns The name, ready to go before `<address>`.
	 */
	static senderName(name: string | null): string {
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
		const clean = (name ?? "").replace(/[\x00-\x1f\x7f"\\<>]/g, "").trim();
		const safe = clean || MAIL_SYSTEM_NAME;
		return /[()[\]:;@,.]/.test(safe) ? `"${safe}"` : safe;
	}

	/**
	 * Read the stored mail settings, with every field defaulted.
	 * @param shopId The shop; none = the platform.
	 * @returns The driver, the sender and every provider's credentials.
	 * They are as stored: secrets still encrypted.
	 */
	async #stored(shopId?: number): Promise<StoredMail> {
		const raw = await this.settingsRepo.get(this.#keyOf(shopId));
		const d = raw ? JSON.parse(raw) : {};
		return {
			driver: d.driver ?? "",
			from_email: d.from_email || this.#oldSender(d),
			credentials: d.credentials ?? {},
		};
	}

	/**
	 * The `settings` key of one mail setup.
	 * @param shopId The shop with its own setup; none = the platform's.
	 * @returns `mail`, or `mail:shop:<id>`.
	 */
	#keyOf(shopId?: number): string {
		return shopId ? `${MAIL_SETTING_KEY}:shop:${shopId}` : MAIL_SETTING_KEY;
	}

	/**
	 * The sender of an older platform row.
	 * Such a row kept a domain or an address in `from_domain`.
	 * A domain becomes `noreply@<domain>`.
	 * That is the address the app's own email used to go out from.
	 * @param d The stored row.
	 * @returns The one sender address, or "".
	 */
	#oldSender(d: { from_domain?: string }): string {
		const v = d.from_domain ?? "";
		return !v || v.includes("@") ? v : `noreply@${v}`;
	}

	/**
	 * Decrypted credentials for one provider.
	 * @param m The mailer definition.
	 * @param all Every provider's stored credentials.
	 * @returns The decrypted field map, or null while a required field is missing.
	 * @throws When APP_KEY no longer decrypts the stored secrets.
	 */
	#credsFor(
		m: Mailer,
		all: StoredMail["credentials"],
	): Record<string, string> | null {
		return openFields(m.fields, all[m.key] ?? {});
	}
}
