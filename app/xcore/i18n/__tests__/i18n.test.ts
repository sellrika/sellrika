import { expect, test } from "bun:test";
import { z } from "zod";
import { negotiate, shopLocales, translate } from "@i18n";
import { I18n, t } from "@xcore/i18n/I18n";
import { LOCALE_COOKIE } from "@constants/Locale.Constant";
import { validate } from "@validators/validate";

test("translate: every language, placeholders, fallback", () => {
	expect(translate("en", "common.save")).toBe("Save");
	expect(translate("de", "common.save")).toBe("Speichern");
	expect(translate("th", "common.save")).toBe("บันทึก");
	expect(translate("de", "common.page_of", { page: 2, pages: 5 })).toBe(
		"Seite 2 von 5",
	);
	expect(translate("en", "common.page_of", { page: 2 })).toBe(
		"Page 2 of {pages}",
	);
});

test("negotiate picks the best Accept-Language the app speaks", () => {
	expect(negotiate(null)).toBe("en");
	expect(negotiate("fr-FR,fr;q=0.9")).toBe("en");
	expect(negotiate("fr;q=0.9,de;q=0.8,en;q=0.7")).toBe("de");
	expect(negotiate("de-CH")).toBe("de");
	expect(negotiate("th-TH,th;q=0.9,en;q=0.8")).toBe("th");
	expect(negotiate("en-US,en;q=0.9,de;q=0.8")).toBe("en");
});

test("localeOf: Accept-Language when there is no cookie", () => {
	const req = new Request("http://localhost/", {
		headers: { "accept-language": "de-DE,de;q=0.9" },
	});
	expect(I18n.localeOf(req)).toBe("de");
	expect(I18n.localeOf(new Request("http://localhost/"))).toBe("en");
});

/**
 * A request with a `lang` cookie and an Accept-Language header, the way Bun hands one to a route.
 * @param cookie The cookie value, or null for none.
 * @param header The Accept-Language header, or null for none.
 * @returns The request.
 */
function visit(cookie: string | null, header: string | null) {
	const req = new Request("http://localhost/", {
		headers: header ? { "accept-language": header } : {},
	});
	return Object.assign(req, {
		cookies: new Map(cookie ? [[LOCALE_COOKIE, cookie]] : []),
	});
}

test("localeOf with a shop's languages: cookie, then Accept-Language, then the shop's default", () => {
	const deOnly = shopLocales("de");
	expect(I18n.localeOf(visit("en", "en-US"), deOnly)).toBe("de"); // English is not offered at all
	expect(I18n.localeOf(visit(null, null), deOnly)).toBe("de");
	const deFirst = shopLocales("de,en");
	expect(I18n.localeOf(visit("en", "de"), deFirst)).toBe("en"); // the cookie wins when the shop offers it
	expect(I18n.localeOf(visit(null, "fr, en;q=0.5"), deFirst)).toBe("en");
	expect(I18n.localeOf(visit(null, "fr"), deFirst)).toBe("de"); // no match → the shop's default, not English
	expect(I18n.localeOf(visit("de", null))).toBe("de"); // no list = every language
	expect(shopLocales("xx, de ,de")).toEqual(["de"]);
	expect(shopLocales("")).toEqual(["en"]);
});

test("narrowLocale changes the running request's language, across awaits", async () => {
	const said = await I18n.withLocale("en", async () => {
		I18n.narrow("de");
		await Promise.resolve();
		return [I18n.current(), t("common.cancel")];
	});
	expect(said).toEqual(["de", "Abbrechen"]);
	I18n.narrow("de"); // outside a request: nothing to change
	expect(I18n.current()).toBe("en");
});

test("withLocale carries the language across awaits; default outside", async () => {
	expect(I18n.current()).toBe("en");
	const inside = await I18n.withLocale("de", async () => {
		await Promise.resolve();
		return t("common.cancel");
	});
	expect(inside).toBe("Abbrechen");
	expect(t("common.cancel")).toBe("Cancel");
});

test("validate translates dictionary keys and Zod's own messages", () => {
	const schema = z.object({
		name: z.string().min(1, "validation.required"),
		email: z.email(),
	});
	const en = validate(schema, { name: "", email: "x" }).errors!;
	expect(en.name).toBe("This field is required");
	expect(en.email).toMatch(/email/i);
	const de = I18n.withLocale(
		"de",
		() => validate(schema, { name: "", email: "x" }).errors!,
	);
	expect(de.name).toBe("Dieses Feld ist erforderlich");
	expect(de.email).toMatch(/E-Mail/);
	const th = I18n.withLocale(
		"th",
		() => validate(schema, { name: "", email: "x" }).errors!,
	);
	expect(th.name).toMatch(/[\u0E00-\u0E7F]/); // our key, in Thai
	expect(th.email).toMatch(/[\u0E00-\u0E7F]/); // Zod's own message, in Thai
});
