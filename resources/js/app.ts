import { type DefineComponent, watch } from "vue";
import { createInertiaApp, router, usePage } from "@inertiajs/vue3";
import "vue-sonner/style.css";
import "@resources/css/app.css";
import type { Key, Locale } from "@i18n";
import { fill, type Params } from "@i18n/fill";
import { trackBack } from "@/lib/back";
import { type PageProps, useDictionary } from "@/lib/i18n";

// not eager: Vite emits one chunk per page, so a visit only downloads the page it opens.
// The staff app only — the public store is server-rendered Edge (resources/views/themes).
const pages = import.meta.glob("./Pages/**/*.vue");
/**
 * The pages of an add-on (`cloud/`, see `app/cloud.ts`).
 * The folder is not in the source-available app, so this is empty there.
 */
const cloudPages = import.meta.glob("../../cloud/resources/js/Pages/**/*.vue");

/**
 * One file per language (`i18n/en.ts`, `de.ts`, `th.ts`), each its own chunk.
 * The browser downloads only the language of the page it shows.
 * `@i18n` itself is never imported as a value here: it holds every language.
 */
const dictionaries = import.meta.glob<Record<string, Record<string, string>>>([
	"../../i18n/*.ts",
	"!../../i18n/index.ts",
	"!../../i18n/fill.ts",
]);

/** An add-on's own words, one file per language like the app's. */
const cloudDictionaries = import.meta.glob<
	Record<string, Record<string, string>>
>(["../../cloud/i18n/*.ts", "!../../cloud/i18n/index.ts"]);

/** The languages downloaded so far: locale → key → text. */
const words: Partial<Record<Locale, Record<string, string>>> = {};

/**
 * Download one language, once.
 * @param locale The language of the page about to be shown.
 */
async function loadWords(locale: Locale) {
	const load = dictionaries[`../../i18n/${locale}.ts`];
	if (words[locale] || !load) return;
	const more = cloudDictionaries[`../../cloud/i18n/${locale}.ts`];
	// both downloads run side by side
	const [own, added] = await Promise.all([load(), more?.()]);
	words[locale] = { ...own[locale], ...added?.[locale] };
}

/**
 * The browser's `translate()`, over the languages downloaded so far.
 * Every language has every key, so there is no English fallback here.
 * @param locale The language to render in.
 * @param key A key of the dictionary.
 * @param params Values for the `{placeholders}` of the text.
 * @returns The text, or the key when it is not known.
 */
function translate(locale: Locale, key: Key, params?: Params): string {
	return fill(words[locale]?.[key] ?? key, params);
}

/**
 * Find a page's component, and get its language ready first.
 * Inertia waits for this before it shows any page, the first one too,
 * so `t()` stays synchronous and a language switch never shows raw keys.
 * @param name The page name, `Customers/Index`.
 * @param page The page about to be shown.
 * @returns The page's component.
 */
async function resolvePage(name: string, page?: { props: unknown }) {
	// both downloads run side by side
	const [component] = await Promise.all([
		(pages[`./Pages/${name}.vue`] ??
			cloudPages[
				`../../cloud/resources/js/Pages/${name}.vue`
			])!() as Promise<DefineComponent>,
		loadWords((page?.props as PageProps)?.locale ?? "en"),
	]);
	return component;
}

// lib/i18n itself stays free of the languages (the store island loads it too)
useDictionary(translate, function pageProps() {
	return usePage().props as PageProps;
});

createInertiaApp({
	// the front page and the pricing page put the name first by themselves
	title: (title) =>
		!title
			? "Sellrika"
			: title.startsWith("Sellrika · ")
				? title
				: `${title} · Sellrika`,
	resolve: resolvePage,
	// no `setup`: Inertia mounts the app itself, and takes over the HTML of a server-rendered page
	progress: { color: "#f9c13b" },
});

/**
 * 1Password: ignore every page but the sign-in page.
 * Signing in and out are Inertia visits, so the <body> attribute follows the page.
 */
watch(
	() => usePage().component,
	function setPasswordManager(component) {
		document.body.toggleAttribute("data-1p-ignore", component !== "Auth/Login");
	},
	{ immediate: true },
);

// The language switch is an Inertia visit, not a page load — keep <html lang> in step with the page's locale.
watch(
	() => (usePage().props as { locale?: string } | undefined)?.locale,
	function setHtmlLang(locale) {
		if (locale) document.documentElement.lang = locale;
	},
	{ immediate: true },
);

/**
 * Google Analytics counts visitors only, never the staff app.
 * Signing in is an Inertia visit, so the tag stays loaded.
 * Switch it off before the page changes, and on again after signing out.
 */
router.on("beforeUpdate", function muteAnalytics(event) {
	const w = window as unknown as Record<string, unknown>;
	const props = event.detail.page.props as { auth?: { user: unknown } };
	if (w.gaId) w[`ga-disable-${w.gaId}`] = !!props.auth?.user;
});

// the back buttons need to know which pages were opened (lib/back.ts)
trackBack();
