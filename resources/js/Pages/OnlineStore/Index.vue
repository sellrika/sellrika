<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Head, Link, router, useForm, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import {
	Bell,
	ChartNoAxesColumn,
	Check,
	Coins,
	Contact,
	Copy,
	CreditCard,
	ExternalLink,
	FileText,
	Globe,
	Languages,
	Loader2,
	Megaphone,
	Pencil,
	Plus,
	Rss,
	Trash2,
	Truck,
	UserRound,
	Settings2,
} from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@/components/ui/input-group";
import ChipPicker from "@/components/ChipPicker.vue";
import { COUNTRIES } from "@/lib/countries";
import CountrySelect from "@/components/store/CountrySelect.vue";
import ThemeConfigDialog from "@/components/store/ThemeConfigDialog.vue";
import {
	currencySymbol,
	fmtDate,
	fromCents,
	money,
	toCents,
} from "@/lib/format";
import CurrencySelect from "@/components/CurrencySelect.vue";
import ExtensionConfigDialog from "@/components/extensions/ExtensionConfigDialog.vue";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import WithTooltip from "@/components/WithTooltip.vue";
import { locale, t } from "@/lib/i18n";
import { LOCALES, type Key, type Locale } from "@i18n";
import type {
	CustomerLogin,
	ExtensionRow,
	GatewayInfo,
	OnlineStoreSettings,
	SharedProps,
	StorePage,
	StoreThemeChoice,
	ThemeColors,
} from "@/types";

type PageRow = Pick<StorePage, "id" | "slug" | "title">;

defineOptions({ layout: AppLayout });
/** Tones of the announcement strip (mirror of STORE_BANNER_TYPES); the dot previews the storefront colour. */
const BANNER_TYPES: { value: string; label: Key; dot: string }[] = [
	{ value: "info", label: "online_store.banner_info", dot: "bg-primary" },
	{
		value: "success",
		label: "online_store.banner_success",
		dot: "bg-emerald-600",
	},
	{
		value: "warning",
		label: "online_store.banner_warning",
		dot: "bg-amber-400",
	},
	{ value: "danger", label: "online_store.banner_danger", dot: "bg-red-600" },
];
const props = defineProps<{
	settings: OnlineStoreSettings;
	/** The built-in themes (STORE_TEMPLATE_INFO); `description` is a dictionary key. */
	templates: {
		key: string;
		label: string;
		description: Key;
		colors: ThemeColors;
	}[];
	/** The fonts a built-in template may use (STORE_FONTS). */
	fonts: { key: string; label: string }[];
	themes: StoreThemeChoice[];
	gateways: GatewayInfo[];
	payments: ExtensionRow[];
	pages: PageRow[];
	section: string | null;
}>();

/** Every look the shop may pick: the built-in templates first, then the themes its extensions bring. */
const templateChoices = computed(() => [
	...props.templates.map((tpl) => ({
		...tpl,
		description: t(tpl.description),
	})),
	...props.themes,
]);

/** The built-in template whose Customize dialog is open (extension themes are set up on /extensions). */
const customizing = ref<{ key: string; label: string } | null>(null);
/** That template's own colours, shown while the shop has picked none. */
const customizingColors = computed(ownColors);

/**
 * The own colours of the template being customized.
 * @returns Its four colours, or undefined when no dialog is open.
 */
function ownColors() {
	return props.templates.find(isCustomizing)?.colors;
}

/**
 * Is this the template whose dialog is open?
 * @param tpl A built-in template.
 * @returns True when it is.
 */
function isCustomizing(tpl: { key: string }) {
	return tpl.key === customizing.value?.key;
}
const customizeOpen = ref(false);

/**
 * Can this look be customized here?
 * @param key The template's key.
 * @returns True for a built-in template.
 */
function isBuiltIn(key: string) {
	return props.templates.some((tpl) => tpl.key === key);
}

/**
 * Open the Customize dialog for one built-in template.
 * @param key The template's key.
 * @param label Its name.
 */
function customize(key: string, label: string) {
	customizing.value = { key, label };
	customizeOpen.value = true;
}

/** Right-hand section rail (deep-linkable via ?section=, e.g. /online-store?section=pages). */
const sections = [
	{ key: "general", label: "online_store.section_general" },
	{ key: "template", label: "online_store.section_template" },
	{ key: "content", label: "online_store.section_content" },
	{ key: "delivery", label: "online_store.section_delivery" },
	{ key: "languages", label: "online_store.section_languages" },
	{ key: "currencies", label: "online_store.section_currencies" },
	{ key: "payments", label: "online_store.section_payments" },
	{ key: "accounts", label: "online_store.section_accounts" },
	{ key: "alerts", label: "online_store.section_alerts" },
	{ key: "pages", label: "online_store.section_pages" },
] as const;
type SectionKey = (typeof sections)[number]["key"];
const valid = (h: string): h is SectionKey => sections.some((s) => s.key === h);
const section = ref<SectionKey>(
	props.section && valid(props.section) ? props.section : "general",
);
watch(section, (s) =>
	history.replaceState(
		null,
		"",
		s === "general" ? location.pathname : `?section=${s}`,
	),
);

const form = useForm({
	enabled: props.settings.enabled,
	slug: props.settings.slug,
	domain: props.settings.domain,
	google_site_verification: props.settings.google_site_verification,
	template: props.settings.template,
	// the manual options (cash on delivery, bank transfer) switched on, and every one's settings side by side
	manual_gateways: [...props.settings.manual_gateways],
	credentials: Object.fromEntries(
		props.gateways.map((g) => [
			g.key,
			{ ...(props.settings.credentials[g.key] ?? {}) },
		]),
	) as Record<string, Record<string, string>>,
	// new-order alerts: the bot token is a secret — blank keeps the stored one
	alert_email: props.settings.alert_email,
	telegram_bot_token: "",
	telegram_chat_id: props.settings.telegram_chat_id,
	ga_id: props.settings.ga_id,
	meta_pixel_id: props.settings.meta_pixel_id,
	// storefront content: the announcement strip and the footer contact block
	banner: props.settings.banner,
	banner_type: props.settings.banner_type,
	phone: props.settings.phone,
	address: props.settings.address,
	hours: props.settings.hours,
	facebook: props.settings.facebook,
	instagram: props.settings.instagram,
	viber: props.settings.viber,
	whatsapp: props.settings.whatsapp,
	support_email: props.settings.support_email,
	// customer accounts: the sign-in providers switched on + the Firebase web config (public values)
	customer_logins: [...props.settings.customer_logins],
	firebase: { ...props.settings.firebase },
});
/** The sign-in providers a shop may switch on (mirror of CUSTOMER_LOGINS), with what to set up in Firebase for each. */
const LOGINS: { key: CustomerLogin; label: Key; hint: Key }[] = [
	{
		key: "email",
		label: "online_store.login_email",
		hint: "online_store.login_email_hint",
	},
	{
		key: "google",
		label: "online_store.login_google",
		hint: "online_store.login_google_hint",
	},
	{
		key: "microsoft",
		label: "online_store.login_microsoft",
		hint: "online_store.login_microsoft_hint",
	},
];
const FIREBASE: {
	name: keyof typeof form.firebase;
	label: Key;
	placeholder: string;
}[] = [
	{
		name: "api_key",
		label: "online_store.firebase_api_key",
		placeholder: "AIza…",
	},
	{
		name: "auth_domain",
		label: "online_store.firebase_auth_domain",
		placeholder: "my-shop.firebaseapp.com",
	},
	{
		name: "project_id",
		label: "online_store.firebase_project_id",
		placeholder: "my-shop",
	},
	{
		name: "app_id",
		label: "online_store.firebase_app_id",
		placeholder: "1:123456789:web:abc123",
	},
];
const loginOn = (k: CustomerLogin) => form.customer_logins.includes(k);
const setLogin = (k: CustomerLogin, on: boolean) =>
	(form.customer_logins = on
		? [...new Set([...form.customer_logins, k])]
		: form.customer_logins.filter((x) => x !== k));
// Delivery has its own form (PUT /online-store/delivery): where the shop is, the shipping zones (prices typed as decimals, sent
// as integer cents; an empty free-delivery amount = no threshold), pick up in store, and whether the checkout's address uses lists
const currency = computed(
	() => usePage<SharedProps>().props.shop?.currency ?? "USD",
);
const COUNTRY_NAMES = COUNTRIES.map((c) => c.name);
const delivery = useForm({
	country: props.settings.country,
	pickup: props.settings.pickup,
	guided_address: props.settings.guided_address,
	delivery_zones: props.settings.delivery_zones.map((z) => ({
		name: z.name,
		countries: [...z.countries],
		states: [...z.states],
		cities: [...z.cities],
		fee: fromCents(z.fee),
		free_delivery_min:
			z.free_delivery_min == null ? "" : fromCents(z.free_delivery_min),
	})),
});
delivery.transform((d) => ({
	...d,
	country: d.country || null,
	delivery_zones: d.delivery_zones.map((z) => ({
		...z,
		fee: toCents(z.fee),
		free_delivery_min: z.free_delivery_min.trim()
			? toCents(z.free_delivery_min)
			: null,
	})),
}));
type ZoneRow = (typeof delivery.delivery_zones)[number];
// Zones are listed in a table and made / changed in a dialog whose Save persists the whole Delivery form at once (like the
// Remove button), so the table always shows what is saved; the outer "Save delivery" is for the country / pick-up / lists.
const zoneDialog = ref<{ index: number | null; zone: ZoneRow } | null>(null); // index null = a new zone
function editZone(index: number | null) {
	const z = index === null ? null : delivery.delivery_zones[index]!;
	delivery.clearErrors();
	zoneDialog.value = {
		index,
		zone: z
			? {
					...z,
					countries: [...z.countries],
					states: [...z.states],
					cities: [...z.cities],
				}
			: {
					name: "",
					countries: [],
					states: [],
					cities: [],
					fee: "",
					free_delivery_min: "",
				},
	};
}
/** Closing without a successful save puts the list back to what the server has (a refused zone is dropped again). */
function closeZone() {
	zoneDialog.value = null;
	delivery.delivery_zones = props.settings.delivery_zones.map((z) => ({
		name: z.name,
		countries: [...z.countries],
		states: [...z.states],
		cities: [...z.cities],
		fee: fromCents(z.fee),
		free_delivery_min:
			z.free_delivery_min == null ? "" : fromCents(z.free_delivery_min),
	}));
}
function saveZone() {
	const d = zoneDialog.value!;
	const zones = [...delivery.delivery_zones];
	if (d.index === null) zones.push(d.zone);
	else zones[d.index] = d.zone;
	delivery.delivery_zones = zones;
	delivery.put("/online-store/delivery", {
		preserveScroll: true,
		onSuccess: () => {
			zoneDialog.value = null;
			toast.success(t("online_store.zone_saved"));
		},
	});
}
function removeZone(index: number) {
	delivery.delivery_zones.splice(index, 1);
	delivery.put("/online-store/delivery", {
		preserveScroll: true,
		onSuccess: () => toast.success(t("online_store.zone_removed")),
	});
}
// the server reports a bad zone as `delivery_zones.<i>` (a place in two zones) or `delivery_zones.<i>.<field>` — one message in the dialog
const zoneError = computed(() => {
	const i = zoneDialog.value
		? (zoneDialog.value.index ?? delivery.delivery_zones.length - 1)
		: -1;
	return Object.entries(delivery.errors as Record<string, string>).find(
		([k]) =>
			k === "delivery_zones" ||
			k === `delivery_zones.${i}` ||
			k.startsWith(`delivery_zones.${i}.`),
	)?.[1];
});
const listOr = (xs: string[], none: string) =>
	xs.length ? xs.join(", ") : none;
/** The table's "Area" cell: the cities, else the states, else the whole country. */
const area = (z: ZoneRow) =>
	z.cities.length
		? z.cities.join(", ")
		: z.states.length
			? z.states.join(", ")
			: "";
/** Suggestions for a zone's States / Cities chips: the downloaded list of its countries (all of them for a rest-of-world zone) — the first page, then what's typed. */
async function findPlaces(
	countries: string[],
	q: string,
	of: "cities" | "states" = "cities",
): Promise<{ places: string[]; more: boolean }> {
	const sp = new URLSearchParams({ q, of });
	for (const c of countries) sp.append("countries", c);
	const res = await fetch(`/online-store/delivery/places?${sp}`, {
		headers: { Accept: "application/json" },
	});
	return res.ok ? await res.json() : { places: [], more: false };
}
/** Languages has its own form (PUT /online-store/languages): the ones the store offers, the default first. */
const languages = useForm({ languages: [...props.settings.languages] });

/**
 * Switch one language on or off for the store (a new one goes after the default).
 * @param l The language.
 * @param on true = offer it.
 */
function setLanguage(l: Locale, on: boolean) {
	languages.languages = on
		? [...new Set([...languages.languages, l])]
		: languages.languages.filter(function other(x) {
				return x !== l;
			});
}

/**
 * Make a language the store's default: it moves to the front of the list.
 * @param l The language.
 */
function setDefaultLanguage(l: Locale) {
	languages.languages = [
		l,
		...languages.languages.filter(function other(x) {
			return x !== l;
		}),
	];
}

/** Save the Languages section. */
function saveLanguages() {
	languages.put("/online-store/languages", {
		preserveScroll: true,
		onSuccess: function saved() {
			toast.success(t("online_store.languages_saved"));
		},
	});
}

/**
 * Currencies has its own form (PUT /online-store/currencies): the extra currencies the store shows prices in.
 * `rate` is the input's text — blank = the automatic rate.
 */
const currencies = useForm({
	currencies: props.settings.currencies.map(function row(c) {
		return { code: c.code, rate: c.rate === null ? "" : String(c.rate) };
	}),
});
/** The currency picked in the "Add" box. */
const addingCurrency = ref("");
/** A readable name for a currency code, in the page's language. */
const currencyName = (code: string) => {
	try {
		return (
			new Intl.DisplayNames([locale()], { type: "currency" }).of(code) ?? code
		);
	} catch {
		return code;
	}
};
/**
 * The automatic rate for one currency, as a line: "Automatic: 1 USD = 0.92 EUR".
 * @param code The currency.
 * @returns The line, or a "no automatic rate" note.
 */
function autoRate(code: string) {
	const r = props.settings.exchange.rates[code];
	return r
		? t("online_store.currency_auto_rate", {
				from: currency.value,
				rate: Number(r.toPrecision(6)),
				to: code,
			})
		: t("online_store.currency_no_auto_rate");
}
/** Put the picked currency on the list (not the shop's own, not twice). */
function addCurrency() {
	const code = addingCurrency.value;
	if (
		code &&
		code !== currency.value &&
		!currencies.currencies.some((c) => c.code === code)
	)
		currencies.currencies.push({ code, rate: "" });
	addingCurrency.value = "";
}
/**
 * Take a currency off the list.
 * @param code The currency.
 */
function removeCurrency(code: string) {
	currencies.currencies = currencies.currencies.filter((c) => c.code !== code);
}
/** Save the Currencies section (a blank rate goes as null = automatic; a number input hands back a number). */
function saveCurrencies() {
	currencies
		.transform(function payload(d) {
			return {
				currencies: d.currencies.map(function row(c) {
					return {
						code: c.code,
						rate: String(c.rate).trim() === "" ? null : Number(c.rate),
					};
				}),
			};
		})
		.put("/online-store/currencies", {
			preserveScroll: true,
			onSuccess: function saved() {
				toast.success(t("online_store.currencies_saved"));
			},
		});
}

function saveDelivery() {
	delivery.put("/online-store/delivery", {
		preserveScroll: true,
		onSuccess: () => toast.success(t("online_store.delivery_saved")),
	});
}

/** The four social links: what the admin pastes and the hint under it. */
const socials = [
	{
		key: "facebook",
		label: "Facebook",
		placeholder: "https://facebook.com/yourpage",
		hint: "online_store.facebook_hint",
	},
	{
		key: "instagram",
		label: "Instagram",
		placeholder: "https://instagram.com/yourshop",
		hint: "online_store.instagram_hint",
	},
	{
		key: "viber",
		label: "Viber",
		placeholder: "+95 9 123 456 789",
		hint: "online_store.viber_hint",
	},
	{
		key: "whatsapp",
		label: "WhatsApp",
		placeholder: "+95 9 123 456 789",
		hint: "online_store.whatsapp_hint",
	},
] as const;

/** Whether a secret field is already stored (badges + "leave blank" placeholders). */
const isSet = (key: string, field: string) =>
	!!props.settings.secret_set[key]?.[field];
const isOn = (g: GatewayInfo) => form.manual_gateways.includes(g.key);
const setGateway = (g: GatewayInfo, on: boolean) =>
	(form.manual_gateways = on
		? [...new Set([...form.manual_gateways, g.key])]
		: form.manual_gateways.filter((k) => k !== g.key));
/** The manual option whose settings are open in the dialog (null = closed). */
const open = ref<string | null>(null);
/** The payment extension whose Configure dialog is open (null = closed). */
const extOpen = ref<string | null>(null);
const extDialog = ref<InstanceType<typeof ExtensionConfigDialog> | null>(null);
const current = computed(
	() => props.gateways.find((g) => g.key === open.value) ?? null,
);

function destroyPage(p: PageRow) {
	router.delete(`/online-store/pages/${p.id}`, {
		preserveScroll: true,
		onSuccess: () =>
			toast.success(t("online_store.page_deleted", { title: p.title })),
	});
}

/** The free address `<slug>.<store domain>`, previewed while the slug is typed. */
const slugUrl = computed(() =>
	props.settings.subdomain_url.replace("{slug}", form.slug || "…"),
);
/** What follows the slug in the free address, like `.shop.sellrika.com`. */
const slugSuffix = computed(
	() => props.settings.subdomain_url.split("{slug}")[1] ?? "",
);
// the address customers use: the custom domain when set, else the free subdomain
// the bare hostname the server will keep (it trims scheme, www., port and path on save) — previewed the same way while typing
const bareDomain = computed(() =>
	form.domain
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, "")
		.replace(/^www\./, "")
		.replace(/[/:].*$/, ""),
);
const publicUrl = computed(() =>
	bareDomain.value ? `https://${bareDomain.value}` : slugUrl.value,
);
// this shop's own sitemap, the one to submit in Google Search Console: at the root of the store's address
const sitemapUrl = computed(() => `${publicUrl.value}/sitemap.xml`);
const copySitemap = () =>
	navigator.clipboard
		.writeText(sitemapUrl.value)
		.then(() => toast.success(t("online_store.sitemap_copied")));
// this shop's product feed, the link to give Google Merchant Center, Facebook and TikTok
const feedUrl = computed(() => `${publicUrl.value}/feed.xml`);
function copyFeed() {
	navigator.clipboard.writeText(feedUrl.value).then(feedCopied);
}
function feedCopied() {
	toast.success(t("online_store.feed_copied"));
}

function save() {
	form.put("/online-store", {
		preserveScroll: true,
		onSuccess: () => {
			for (const g of props.gateways)
				for (const f of g.fields)
					if (f.secret) form.credentials[g.key]![f.name] = "";
			form.telegram_bot_token = "";
			toast.success(t("online_store.settings_saved"));
			open.value = null; // the settings dialog saves the same form — close it once that went through
		},
		// a missing value is only visible inside its dialog — open it on that option
		onError: (errors) =>
			(open.value =
				Object.keys(errors)
					.find((k) => k.startsWith("credentials."))
					?.split(".")[1] ?? open.value),
	});
}

/**
 * The saved domain's setup: the records to add and its status.
 * Null while the domain isn't saved yet, or when nobody manages domains here.
 */
const domainSetup = computed(() =>
	props.settings.domain && bareDomain.value === props.settings.domain
		? props.settings.domain_setup
		: null,
);

/**
 * Look at the domain's DNS now, then say how it went.
 */
function checkDomain() {
	router.post(
		"/online-store/domain/check",
		{},
		{ preserveScroll: true, onSuccess: announceDomain },
	);
}

/**
 * Tell whether the check made the domain live.
 */
function announceDomain() {
	if (props.settings.domain_setup?.status === "live")
		toast.success(t("online_store.domain_now_live"));
	else toast.info(t("online_store.domain_still_pending"));
}

/**
 * Copy one DNS value to the clipboard.
 * @param value The text to copy.
 */
async function copyValue(value: string) {
	await navigator.clipboard.writeText(value);
	toast.success(t("online_store.value_copied"));
}

async function copyUrl() {
	await navigator.clipboard.writeText(publicUrl.value);
	toast.success(t("online_store.link_copied"));
}
</script>

<template>
  <Head :title="t('online_store.title')" />
  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <div>
      <h1 class="text-2xl font-semibold">{{ t("online_store.title") }}</h1>
      <p class="text-sm text-muted-foreground">{{ t("online_store.subtitle") }}</p>
    </div>

    <div class="flex flex-col gap-6 md:flex-row">
      <!-- content -->
      <div class="order-2 min-w-0 flex-1 md:order-1">
        <form class="space-y-6" @submit.prevent="save">
          <!-- General: enable + URL -->
          <Card v-show="section === 'general'">
            <CardHeader>
              <CardTitle class="flex items-center gap-2"><Globe class="size-5" /> {{ t("online_store.storefront") }}</CardTitle>
              <CardDescription>{{ t("online_store.storefront_desc") }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div class="flex items-center justify-between rounded-xl border p-4">
                <div>
                  <Label for="store-enabled" class="text-base">{{ form.enabled ? t("online_store.store_is_live") : t("online_store.store_is_off") }}</Label>
                  <p class="text-sm text-muted-foreground">{{ form.enabled ? t("online_store.live_hint") : t("online_store.off_hint") }}</p>
                </div>
                <Switch id="store-enabled" v-model="form.enabled" :aria-label="t('online_store.enable_aria')" />
              </div>
              <div class="grid gap-2">
                <Label for="store-slug">{{ t("online_store.store_url") }}</Label>
                <div class="flex items-center gap-2">
                  <Input id="store-slug" v-model="form.slug" placeholder="my-shop" :aria-invalid="!!form.errors.slug" />
                  <span class="hidden shrink-0 text-sm text-muted-foreground sm:inline">{{ slugSuffix }}</span>
                  <WithTooltip :label="t('online_store.copy_link_aria')"><Button type="button" variant="outline" size="icon" :aria-label="t('online_store.copy_link_aria')" @click="copyUrl"><Copy /></Button></WithTooltip>
                  <WithTooltip :label="t('online_store.open_url_aria', { url: publicUrl })">
                    <Button as-child variant="outline" size="icon" :aria-label="t('online_store.open_url_aria', { url: publicUrl })">
                      <a :href="slugUrl" target="_blank" rel="noopener"><ExternalLink /></a>
                    </Button>
                  </WithTooltip>
                </div>
                <p v-if="form.errors.slug" class="text-sm text-destructive">{{ form.errors.slug }}</p>
                <p v-else class="text-xs text-muted-foreground">{{ slugUrl }}</p>
              </div>
              <div class="grid gap-2">
                <Label for="store-domain">{{ t("online_store.custom_domain") }} <span class="text-muted-foreground">{{ t("online_store.optional_paren") }}</span></Label>
                <div class="flex items-center gap-2">
                  <Input id="store-domain" v-model="form.domain" placeholder="shop.example.com" :aria-invalid="!!form.errors.domain" />
                  <WithTooltip v-if="form.domain" :label="t('online_store.open_url_aria', { url: `https://${form.domain}` })">
                    <Button as-child variant="outline" size="icon" :aria-label="t('online_store.open_url_aria', { url: `https://${form.domain}` })">
                      <a :href="`https://${form.domain}`" target="_blank" rel="noopener"><ExternalLink /></a>
                    </Button>
                  </WithTooltip>
                </div>
                <p v-if="form.errors.domain" class="text-sm text-destructive">{{ form.errors.domain }}</p>
                <p v-else-if="!domainSetup" class="text-xs text-muted-foreground">{{ settings.domain_setup ? t("online_store.domain_hint_managed") : t("online_store.domain_hint") }}</p>
              </div>
              <!-- the saved domain: live, or the DNS records still to add -->
              <div v-if="domainSetup" class="space-y-3 rounded-xl border p-4" data-testid="domain-setup">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <Badge v-if="domainSetup.status === 'live'" class="gap-1"><Check class="size-3" /> {{ t("online_store.domain_live") }}</Badge>
                  <Badge v-else variant="outline">{{ t("online_store.domain_pending") }}</Badge>
                  <Button v-if="domainSetup.status !== 'live'" type="button" variant="outline" size="sm" @click="checkDomain">{{ t("online_store.domain_check") }}</Button>
                </div>
                <p v-if="domainSetup.status === 'live'" class="text-sm text-muted-foreground">{{ t("online_store.domain_live_hint", { url: `https://${settings.domain}` }) }}</p>
                <template v-else>
                  <p class="text-sm">{{ t("online_store.domain_records") }}</p>
                  <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                      <thead class="text-left text-xs text-muted-foreground">
                        <tr>
                          <th class="py-1 pr-3 font-medium">{{ t("online_store.domain_type") }}</th>
                          <th class="py-1 pr-3 font-medium">{{ t("online_store.domain_name") }}</th>
                          <th class="py-1 font-medium">{{ t("online_store.domain_value") }}</th>
                        </tr>
                      </thead>
                      <tbody class="font-mono">
                        <tr class="border-t">
                          <td class="py-2 pr-3 align-top">CNAME</td>
                          <td class="py-2 pr-3 align-top break-all">{{ settings.domain }}</td>
                          <td class="py-2 align-top">
                            <span class="inline-flex items-center gap-1 break-all">
                              {{ domainSetup.cname }}
                              <WithTooltip :label="t('online_store.copy_value_aria', { value: domainSetup.cname })"><Button type="button" variant="ghost" size="icon" class="size-7" :aria-label="t('online_store.copy_value_aria', { value: domainSetup.cname })" @click="copyValue(domainSetup.cname)"><Copy class="size-3.5" /></Button></WithTooltip>
                            </span>
                            <p class="font-sans text-xs text-muted-foreground">{{ t("online_store.domain_for_sub") }}</p>
                          </td>
                        </tr>
                        <tr v-for="ip in domainSetup.ips" :key="ip" class="border-t">
                          <td class="py-2 pr-3 align-top">A</td>
                          <td class="py-2 pr-3 align-top break-all">{{ settings.domain }}</td>
                          <td class="py-2 align-top">
                            <span class="inline-flex items-center gap-1">
                              {{ ip }}
                              <WithTooltip :label="t('online_store.copy_value_aria', { value: ip })"><Button type="button" variant="ghost" size="icon" class="size-7" :aria-label="t('online_store.copy_value_aria', { value: ip })" @click="copyValue(ip)"><Copy class="size-3.5" /></Button></WithTooltip>
                            </span>
                            <p class="font-sans text-xs text-muted-foreground">{{ t("online_store.domain_for_root") }}</p>
                          </td>
                        </tr>
                        <tr class="border-t">
                          <td class="py-2 pr-3 align-top">TXT</td>
                          <td class="py-2 pr-3 align-top break-all">{{ domainSetup.txt.name }}</td>
                          <td class="py-2 align-top">
                            <span class="inline-flex items-center gap-1 break-all">
                              {{ domainSetup.txt.value }}
                              <WithTooltip :label="t('online_store.copy_value_aria', { value: 'TXT' })"><Button type="button" variant="ghost" size="icon" class="size-7" :aria-label="t('online_store.copy_value_aria', { value: 'TXT' })" @click="copyValue(domainSetup.txt.value)"><Copy class="size-3.5" /></Button></WithTooltip>
                            </span>
                            <p class="font-sans text-xs text-muted-foreground">{{ t("online_store.domain_for_txt") }}</p>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p class="text-sm" data-testid="domain-found">{{ domainSetup.found.length ? t("online_store.domain_found", { found: domainSetup.found.join(", ") }) : t("online_store.domain_found_none") }}</p>
                  <ul class="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    <li>{{ t("online_store.domain_tip_other") }}</li>
                    <li>{{ t("online_store.domain_tip_cloudflare") }}</li>
                    <li>{{ t("online_store.domain_tip_www") }}</li>
                    <li>{{ t("online_store.domain_tip_wait") }}</li>
                  </ul>
                </template>
              </div>
            </CardContent>
          </Card>

          <!-- Search engines: Google verification + the sitemap to submit -->
          <Card v-show="section === 'general'">
            <CardHeader>
              <CardTitle class="flex items-center gap-2">
                <!-- Google "G" mark (official 4-colour paths) -->
                <svg viewBox="0 0 48 48" class="size-5 shrink-0" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
                Google Search Console
              </CardTitle>
              <CardDescription>{{ t("online_store.gsc_desc") }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div class="grid gap-2">
                <Label for="store-google">{{ t("online_store.verification") }} <span class="text-muted-foreground">{{ t("online_store.optional_paren") }}</span></Label>
                <div class="flex items-center gap-2">
                  <Input id="store-google" v-model="form.google_site_verification" placeholder='<meta name="google-site-verification" content="…">' :aria-invalid="!!form.errors.google_site_verification" />
                  <WithTooltip :label="t('online_store.gsc_open_aria')">
                    <Button as-child variant="outline" size="icon" :aria-label="t('online_store.gsc_open_aria')">
                      <a href="https://search.google.com/search-console" target="_blank" rel="noopener"><ExternalLink /></a>
                    </Button>
                  </WithTooltip>
                </div>
                <p v-if="form.errors.google_site_verification" class="text-sm text-destructive">{{ form.errors.google_site_verification }}</p>
                <p v-else class="text-xs text-muted-foreground">
                  {{ t("online_store.gsc_in") }} <a href="https://search.google.com/search-console" target="_blank" rel="noopener" class="underline">Search Console</a> {{ t("online_store.gsc_hint", { url: publicUrl }) }}
                </p>
              </div>
              <div class="space-y-2">
                <Label>{{ t("online_store.sitemap") }}</Label>
                <div class="flex items-center gap-2">
                  <a :href="sitemapUrl" target="_blank" rel="noopener" class="min-w-0 truncate font-mono text-sm hover:underline">{{ sitemapUrl }}</a>
                  <WithTooltip :label="t('online_store.copy_sitemap_aria')"><Button type="button" variant="outline" size="icon" :aria-label="t('online_store.copy_sitemap_aria')" @click="copySitemap"><Copy /></Button></WithTooltip>
                </div>
                <p class="text-xs text-muted-foreground">{{ t("online_store.sitemap_hint") }}</p>
              </div>
            </CardContent>
          </Card>

          <!-- Product feed: the link Google Merchant Center, Facebook / Instagram and TikTok read -->
          <Card v-show="section === 'general'">
            <CardHeader>
              <CardTitle class="flex items-center gap-2"><Rss class="size-5" /> {{ t("online_store.feed") }}</CardTitle>
              <CardDescription>{{ t("online_store.feed_desc") }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-2">
              <div class="flex items-center gap-2">
                <a :href="feedUrl" target="_blank" rel="noopener" class="min-w-0 truncate font-mono text-sm hover:underline">{{ feedUrl }}</a>
                <WithTooltip :label="t('online_store.copy_feed_aria')"><Button type="button" variant="outline" size="icon" :aria-label="t('online_store.copy_feed_aria')" @click="copyFeed"><Copy /></Button></WithTooltip>
              </div>
              <p class="text-xs text-muted-foreground">{{ t("online_store.feed_hint") }}</p>
            </CardContent>
          </Card>

          <!-- Analytics: GA4 + Meta Pixel, loaded on every store page -->
          <Card v-show="section === 'general'">
            <CardHeader>
              <CardTitle class="flex items-center gap-2"><ChartNoAxesColumn class="size-5" /> {{ t("online_store.analytics") }}</CardTitle>
              <CardDescription>{{ t("online_store.analytics_desc") }}</CardDescription>
            </CardHeader>
            <CardContent class="grid gap-4 sm:grid-cols-2">
              <div class="grid gap-2">
                <Label for="store-ga">Google Analytics</Label>
                <Input id="store-ga" v-model="form.ga_id" placeholder="G-XXXXXXXXXX" :aria-invalid="!!form.errors.ga_id" />
                <p v-if="form.errors.ga_id" class="text-sm text-destructive">{{ form.errors.ga_id }}</p>
                <p v-else class="text-xs text-muted-foreground">{{ t("online_store.ga_hint") }}</p>
              </div>
              <div class="grid gap-2">
                <Label for="store-pixel">Meta Pixel</Label>
                <Input id="store-pixel" v-model="form.meta_pixel_id" inputmode="numeric" placeholder="123456789012345" :aria-invalid="!!form.errors.meta_pixel_id" />
                <p v-if="form.errors.meta_pixel_id" class="text-sm text-destructive">{{ form.errors.meta_pixel_id }}</p>
                <p v-else class="text-xs text-muted-foreground">{{ t("online_store.pixel_hint") }}</p>
              </div>
            </CardContent>
          </Card>

          <!-- Template -->
          <Card v-show="section === 'template'">
            <CardHeader>
              <CardTitle>{{ t("online_store.section_template") }}</CardTitle>
              <CardDescription>{{ t("online_store.template_desc") }}</CardDescription>
            </CardHeader>
            <CardContent>
              <div class="grid gap-3 sm:grid-cols-2">
                <div v-for="{ key, label, description } in templateChoices" :key="key" class="relative">
                  <button type="button" :aria-pressed="form.template === key"
                    class="flex size-full items-start gap-3 rounded-xl border p-4 pr-12 text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    :class="form.template === key ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted'"
                    @click="form.template = key">
                    <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border" :class="form.template === key ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'">
                      <Check v-if="form.template === key" class="size-3" />
                    </span>
                    <span>
                      <span class="block font-medium">{{ label }}</span>
                      <span class="block text-sm text-muted-foreground">{{ description }}</span>
                      <span v-if="settings.theme_config[key]" class="mt-1 block text-xs font-medium text-primary">{{ t("online_store.theme_customized") }}</span>
                    </span>
                  </button>
                  <WithTooltip v-if="isBuiltIn(key)" :label="t('online_store.theme_customize')">
                    <Button type="button" variant="ghost" size="icon" class="absolute top-2 right-2" :aria-label="t('online_store.theme_title', { name: label })" @click="customize(key, label)">
                      <Settings2 class="size-4" />
                    </Button>
                  </WithTooltip>
                </div>
              </div>
              <ThemeConfigDialog v-if="customizing" v-model:open="customizeOpen" :template="customizing" :look="settings.theme_config[customizing.key]" :own="customizingColors" :fonts="fonts" />
              <p v-if="form.errors.template" class="mt-2 text-sm text-destructive">{{ form.errors.template }}</p>
            </CardContent>
          </Card>


          <!-- Banner: one announcement line printed above every template's header -->
          <Card v-show="section === 'content'">
            <CardHeader>
              <CardTitle class="flex items-center gap-2"><Megaphone class="size-5" /> {{ t("online_store.banner") }}</CardTitle>
              <CardDescription>{{ t("online_store.banner_desc") }}</CardDescription>
            </CardHeader>
            <CardContent class="grid gap-4 sm:grid-cols-[1fr_11rem]">
              <div class="grid gap-2">
                <Label for="store-banner">{{ t("online_store.banner_text") }}</Label>
                <Input id="store-banner" v-model="form.banner" maxlength="200" :placeholder="t('online_store.banner_placeholder')" :aria-invalid="!!form.errors.banner" />
                <p v-if="form.errors.banner" class="text-sm text-destructive">{{ form.errors.banner }}</p>
              </div>
              <div class="grid gap-2">
                <Label for="store-banner-type">{{ t("online_store.banner_type") }}</Label>
                <Select v-model="form.banner_type">
                  <SelectTrigger id="store-banner-type" class="w-full" :aria-label="t('online_store.banner_type')"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="b in BANNER_TYPES" :key="b.value" :value="b.value"><span class="size-2.5 rounded-full" :class="b.dot" /> {{ t(b.label) }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <!-- Contact: phone / address / hours + social links, printed in every template's footer -->
          <Card v-show="section === 'content'">
            <CardHeader>
              <CardTitle class="flex items-center gap-2"><Contact class="size-5" /> {{ t("online_store.contact") }}</CardTitle>
              <CardDescription>{{ t("online_store.contact_desc") }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div class="grid gap-2">
                <Label for="store-support-email">{{ t("online_store.support_email") }}</Label>
                <Input id="store-support-email" v-model="form.support_email" type="email" placeholder="support@example.com" :aria-invalid="!!form.errors.support_email" />
                <p v-if="form.errors.support_email" class="text-sm text-destructive">{{ form.errors.support_email }}</p>
                <p v-else class="text-xs text-muted-foreground">{{ t("online_store.support_email_hint") }}</p>
              </div>
              <div class="grid gap-2">
                <Label for="store-phone">{{ t("common.phone") }}</Label>
                <Input id="store-phone" v-model="form.phone" type="tel" placeholder="+95 9 123 456 789" :aria-invalid="!!form.errors.phone" />
                <p v-if="form.errors.phone" class="text-sm text-destructive">{{ form.errors.phone }}</p>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <div class="grid gap-2">
                  <Label for="store-address">{{ t("common.address") }}</Label>
                  <Textarea id="store-address" v-model="form.address" rows="3" :placeholder="t('online_store.address_placeholder')" :aria-invalid="!!form.errors.address" />
                  <p v-if="form.errors.address" class="text-sm text-destructive">{{ form.errors.address }}</p>
                </div>
                <div class="grid gap-2">
                  <Label for="store-hours">{{ t("online_store.hours") }}</Label>
                  <Textarea id="store-hours" v-model="form.hours" rows="3" :placeholder="t('online_store.hours_placeholder')" :aria-invalid="!!form.errors.hours" />
                  <p v-if="form.errors.hours" class="text-sm text-destructive">{{ form.errors.hours }}</p>
                </div>
              </div>
              <Separator />
              <div class="grid gap-4 sm:grid-cols-2">
                <div v-for="s in socials" :key="s.key" class="grid gap-2">
                  <Label :for="`store-${s.key}`">{{ s.label }}</Label>
                  <Input :id="`store-${s.key}`" v-model="form[s.key]" :placeholder="s.placeholder" :aria-invalid="!!form.errors[s.key]" />
                  <p v-if="form.errors[s.key]" class="text-sm text-destructive">{{ form.errors[s.key] }}</p>
                  <p v-else class="text-xs text-muted-foreground">{{ t(s.hint) }}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <!-- Payments: the manual options are built in (saved with the page); the online providers are extensions (saved at once from their own dialog) -->
          <Card v-show="section === 'payments'">
            <CardHeader>
              <CardTitle class="flex items-center gap-2"><CreditCard class="size-5" /> {{ t("online_store.payments") }}</CardTitle>
              <CardDescription>
                {{ t("online_store.payments_desc_1") }}
                <Link href="/extensions" class="font-medium text-foreground underline underline-offset-2 hover:opacity-80">{{ t("online_store.extensions_link") }}</Link>.
                {{ t("online_store.payments_desc_2") }}
              </CardDescription>
            </CardHeader>
            <CardContent class="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="pl-6">{{ t("online_store.manual_option") }}</TableHead>
                    <TableHead class="w-24">{{ t("extensions.enabled") }}</TableHead>
                    <TableHead class="w-28 pr-6 text-right">{{ t("common.actions") }}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="g in gateways" :key="g.key" class="cursor-pointer" @click="open = g.key">
                    <TableCell class="pl-6 font-medium">
                      <span class="flex items-center gap-3"><CreditCard class="size-6 rounded-md bg-muted p-1 text-muted-foreground" /> {{ g.label }}</span>
                    </TableCell>
                    <TableCell @click.stop>
                      <Switch :model-value="isOn(g)" :aria-label="t('online_store.gateway_payments_aria', { name: g.label })" @update:model-value="(v: boolean) => setGateway(g, v)" />
                    </TableCell>
                    <TableCell class="pr-6 text-right">
                      <Button type="button" variant="ghost" size="sm" :aria-label="t('online_store.configure_gateway_aria', { name: g.label })" @click.stop="open = g.key"><Pencil /> {{ t("extensions.configure") }}</Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              <!-- payment extensions: switched on and set up right here, with the same dialog as /extensions -->
              <div class="space-y-3 px-6 pt-6">
                <h3 class="text-sm font-medium">{{ t("online_store.payment_extensions") }}</h3>
                <p v-if="!payments.length" class="text-sm text-muted-foreground">{{ t("online_store.no_payment_extension") }}</p>
                <div v-for="e in payments" :key="e.key" class="flex flex-wrap items-center gap-3 rounded-md border p-3">
                  <img v-if="e.icon" :src="e.icon" alt="" class="size-6 rounded-md object-contain" />
                  <CreditCard v-else class="size-6 rounded-md bg-muted p-1 text-muted-foreground" />
                  <span class="font-medium">{{ e.name }}</span>
                  <!-- the same states the Extensions page shows -->
                  <Badge v-if="!e.installed" variant="outline" class="text-muted-foreground">{{ t("extensions.not_installed") }}</Badge>
                  <Badge v-else-if="e.problem" variant="outline" class="border-destructive/50 text-destructive">{{ t("extensions.keys_unreadable") }}</Badge>
                  <Badge v-else-if="e.ready" variant="outline" class="border-emerald-300 text-emerald-700 dark:text-emerald-400">{{ t("extensions.ready") }}</Badge>
                  <Badge v-else variant="outline" class="border-amber-300 text-amber-700 dark:text-amber-400">{{ t("extensions.needs_setup") }}</Badge>
                  <span class="ml-auto flex items-center gap-2">
                    <Switch :model-value="e.installed && e.enabled" :aria-label="t('extensions.enabled_aria', { name: e.name })" @update:model-value="(v: boolean) => extDialog?.toggle(e, v)" />
                    <Button type="button" variant="ghost" size="sm" :aria-label="t('extensions.configure_aria', { name: e.name })" @click="extOpen = e.key"><Pencil /> {{ t("extensions.configure") }}</Button>
                  </span>
                </div>
              </div>
              <ExtensionConfigDialog ref="extDialog" v-model:open="extOpen" :extensions="payments" />
            </CardContent>
          </Card>

          <!-- Authentication: customers sign in with email / Google / Microsoft through the shop's own Firebase project -->
          <Card v-show="section === 'accounts'">
            <CardHeader>
              <CardTitle class="flex items-center gap-2"><UserRound class="size-5" /> {{ t("online_store.authentication") }}</CardTitle>
              <CardDescription>
                {{ t("online_store.auth_desc_1") }}
                <a href="https://console.firebase.google.com" target="_blank" rel="noopener" class="underline">Firebase</a>
                {{ t("online_store.auth_desc_2") }}
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-6">
              <div class="divide-y rounded-xl border">
                <div v-for="l in LOGINS" :key="l.key" class="flex items-start gap-3 p-4">
                  <Switch :id="`login-${l.key}`" :model-value="loginOn(l.key)" :aria-label="t('online_store.sign_in_with_aria', { name: t(l.label) })" @update:model-value="(v: boolean) => setLogin(l.key, v)" />
                  <div class="grid gap-1">
                    <Label :for="`login-${l.key}`">{{ t(l.label) }}</Label>
                    <p class="text-xs text-muted-foreground">{{ t(l.hint) }}</p>
                  </div>
                </div>
              </div>
              <p v-if="form.errors.customer_logins" class="text-sm text-destructive">{{ form.errors.customer_logins }}</p>
              <Separator />
              <div class="grid gap-1">
                <Label>{{ t("online_store.firebase_app") }}</Label>
                <p class="text-xs text-muted-foreground">{{ t("online_store.firebase_hint_1") }} <code>firebaseConfig</code>{{ t("online_store.firebase_hint_2") }}</p>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <div v-for="f in FIREBASE" :key="f.name" class="grid gap-2">
                  <Label :for="`firebase-${f.name}`">{{ t(f.label) }}</Label>
                  <Input :id="`firebase-${f.name}`" v-model="form.firebase[f.name]" :placeholder="f.placeholder" autocomplete="off" :aria-invalid="!!form.errors[`firebase.${f.name}`]" />
                  <p v-if="form.errors[`firebase.${f.name}`]" class="text-sm text-destructive">{{ form.errors[`firebase.${f.name}`] }}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <!-- New-order alerts to the owner: email through the account's mail settings, and/or a Telegram bot -->
          <Card v-show="section === 'alerts'">
            <CardHeader>
              <CardTitle class="flex items-center gap-2"><Bell class="size-5" /> {{ t("online_store.alerts") }}</CardTitle>
              <CardDescription>{{ t("online_store.alerts_desc") }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-6">
              <div class="grid gap-2">
                <Label for="alert-email">{{ t("online_store.alert_email") }}</Label>
                <Input id="alert-email" v-model="form.alert_email" type="email" placeholder="owner@example.com" :aria-invalid="!!form.errors.alert_email" />
                <p v-if="form.errors.alert_email" class="text-sm text-destructive">{{ form.errors.alert_email }}</p>
                <p v-else class="text-xs text-muted-foreground">{{ t("online_store.alert_email_hint_1") }} <Link v-if="$page.props.auth.user?.platform" href="/email" class="underline">{{ t("online_store.email_settings_link") }}</Link><template v-else>{{ t("online_store.email_settings_link") }}</template> {{ t("online_store.alert_email_hint_2") }}</p>
              </div>
              <Separator />
              <div class="grid gap-4 sm:grid-cols-2">
                <div class="grid gap-2">
                  <div class="flex items-center gap-2">
                    <Label for="alert-tg-token">{{ t("online_store.telegram_token") }}</Label>
                    <Badge v-if="settings.telegram_token_set" variant="outline" class="border-emerald-300 text-emerald-700 dark:text-emerald-400">{{ t("extensions.saved_badge") }}</Badge>
                  </div>
                  <Input id="alert-tg-token" v-model="form.telegram_bot_token" type="password" autocomplete="off"
                    :placeholder="settings.telegram_token_set ? t('extensions.keep_blank') : '123456789:ABC…'" :aria-invalid="!!form.errors.telegram_bot_token" />
                  <p v-if="form.errors.telegram_bot_token" class="text-sm text-destructive">{{ form.errors.telegram_bot_token }}</p>
                </div>
                <div class="grid gap-2">
                  <Label for="alert-tg-chat">{{ t("online_store.telegram_chat") }}</Label>
                  <Input id="alert-tg-chat" v-model="form.telegram_chat_id" inputmode="numeric" placeholder="123456789" :aria-invalid="!!form.errors.telegram_chat_id" />
                  <p v-if="form.errors.telegram_chat_id" class="text-sm text-destructive">{{ form.errors.telegram_chat_id }}</p>
                </div>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ t("online_store.telegram_hint_1") }} <a href="https://t.me/BotFather" target="_blank" rel="noopener" class="underline">@BotFather</a>
                {{ t("online_store.telegram_hint_2") }} <a href="https://t.me/userinfobot" target="_blank" rel="noopener" class="underline">@userinfobot</a>
                {{ t("online_store.telegram_hint_3") }}
              </p>
            </CardContent>
          </Card>

          <div v-show="section !== 'pages' && section !== 'delivery' && section !== 'languages' && section !== 'currencies'" class="flex justify-end">
            <Button type="submit" :disabled="form.processing">
              <Loader2 v-if="form.processing" class="animate-spin" /> {{ t("online_store.save_settings") }}
            </Button>
          </div>
        </form>

        <!-- Delivery: its own form — where the shop is, the shipping zones (Shopify-style), pick up in store, address lists at the checkout -->
        <form v-show="section === 'delivery'" class="space-y-6" @submit.prevent="saveDelivery">
          <Card>
            <CardHeader>
              <CardTitle class="flex items-center gap-2"><Truck class="size-5" /> {{ t("online_store.delivery") }}</CardTitle>
              <CardDescription>{{ t("online_store.delivery_desc") }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-6">
              <div class="grid gap-2">
                <Label for="delivery-country">{{ t("online_store.country") }}</Label>
                <CountrySelect id="delivery-country" v-model="delivery.country" :invalid="!!delivery.errors.country" />
                <p v-if="delivery.errors.country" class="text-sm text-destructive">{{ delivery.errors.country }}</p>
                <p v-else class="text-xs text-muted-foreground">{{ t("online_store.country_hint") }}</p>
              </div>
              <Separator />
              <div class="grid gap-3">
                <div class="flex items-start justify-between gap-4">
                  <div class="grid gap-1">
                    <Label>{{ t("online_store.zones") }}</Label>
                    <p class="text-xs text-muted-foreground">{{ t("online_store.zones_hint") }}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" class="shrink-0" @click="editZone(null)"><Plus /> {{ t("online_store.add_zone") }}</Button>
                </div>
                <Table v-if="delivery.delivery_zones.length" :aria-label="t('online_store.zones')">
                  <TableHeader>
                    <TableRow><TableHead>{{ t("online_store.zone") }}</TableHead><TableHead>{{ t("online_store.countries") }}</TableHead><TableHead>{{ t("online_store.area") }}</TableHead><TableHead class="text-right">{{ t("common.price") }}</TableHead><TableHead class="text-right">{{ t("online_store.free_from") }}</TableHead><TableHead class="w-px"></TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow v-for="(z, i) in delivery.delivery_zones" :key="i" data-zone>
                      <TableCell class="font-medium">{{ z.name || t("online_store.zone_n", { n: i + 1 }) }}</TableCell>
                      <TableCell class="max-w-64 truncate" :title="listOr(z.countries, '')" :class="!z.countries.length && 'text-muted-foreground'">{{ listOr(z.countries, t("online_store.every_other_country")) }}</TableCell>
                      <TableCell class="max-w-48 truncate" :title="area(z)" :class="!area(z) && 'text-muted-foreground'">{{ area(z) || t("online_store.whole_country") }}</TableCell>
                      <TableCell class="text-right tabular-nums">{{ money(toCents(z.fee), currency) }}</TableCell>
                      <TableCell class="text-right tabular-nums" :class="!z.free_delivery_min && 'text-muted-foreground'">{{ z.free_delivery_min ? money(toCents(z.free_delivery_min), currency) : "—" }}</TableCell>
                      <TableCell class="whitespace-nowrap">
                        <WithTooltip :label="t('online_store.edit_zone_aria', { n: i + 1 })"><Button type="button" size="icon" variant="ghost" :aria-label="t('online_store.edit_zone_aria', { n: i + 1 })" @click="editZone(i)"><Pencil /></Button></WithTooltip>
                        <WithTooltip :label="t('online_store.remove_zone_aria', { n: i + 1 })"><Button type="button" size="icon" variant="ghost" :aria-label="t('online_store.remove_zone_aria', { n: i + 1 })" :disabled="delivery.processing" @click="removeZone(i)"><Trash2 /></Button></WithTooltip>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <p v-else class="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground" data-no-zones>{{ t("online_store.no_zones") }}</p>
                <p v-if="delivery.errors.delivery_zones && !zoneDialog" class="text-sm text-destructive">{{ delivery.errors.delivery_zones }}</p>
              </div>
              <Separator />
              <div class="flex items-start gap-3">
                <Switch id="delivery-pickup" v-model="delivery.pickup" :aria-label="t('online_store.pickup')" />
                <div class="grid gap-1">
                  <Label for="delivery-pickup">{{ t("online_store.pickup") }}</Label>
                  <p class="text-xs text-muted-foreground">{{ t("online_store.pickup_hint") }}</p>
                </div>
              </div>
              <div class="flex items-start gap-3">
                <Switch id="delivery-guided" v-model="delivery.guided_address" :aria-label="t('online_store.guided')" />
                <div class="grid gap-1">
                  <Label for="delivery-guided">{{ t("online_store.guided") }}</Label>
                  <p class="text-xs text-muted-foreground">{{ t("online_store.guided_hint") }}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <div class="flex justify-end">
            <Button type="submit" :disabled="delivery.processing">
              <Loader2 v-if="delivery.processing" class="animate-spin" /> {{ t("online_store.save_delivery") }}
            </Button>
          </div>
        </form>

        <!-- Languages: its own form — which of the app's languages the store offers; the default comes first -->
        <form v-show="section === 'languages'" class="space-y-6" @submit.prevent="saveLanguages">
          <Card>
            <CardHeader>
              <CardTitle class="flex items-center gap-2"><Languages class="size-5" /> {{ t("online_store.section_languages") }}</CardTitle>
              <CardDescription>{{ t("online_store.languages_desc") }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-3">
              <div class="divide-y rounded-xl border">
                <div v-for="l in LOCALES" :key="l" class="flex items-center gap-3 p-4" data-language>
                  <Switch :id="`language-${l}`" :model-value="languages.languages.includes(l)" :aria-label="t(`lang.${l}`)" @update:model-value="setLanguage(l, $event)" />
                  <Label :for="`language-${l}`" class="flex-1">{{ t(`lang.${l}`) }}</Label>
                  <Badge v-if="languages.languages[0] === l" variant="secondary">{{ t("online_store.language_default") }}</Badge>
                  <Button v-else-if="languages.languages.includes(l)" type="button" size="sm" variant="ghost" @click="setDefaultLanguage(l)">{{ t("online_store.language_make_default") }}</Button>
                </div>
              </div>
              <p v-if="languages.errors.languages" class="text-sm text-destructive">{{ languages.errors.languages }}</p>
              <p v-else class="text-xs text-muted-foreground">{{ t("online_store.languages_hint") }}</p>
            </CardContent>
          </Card>
          <div class="flex justify-end">
            <Button type="submit" :disabled="languages.processing">
              <Loader2 v-if="languages.processing" class="animate-spin" /> {{ t("online_store.save_languages") }}
            </Button>
          </div>
        </form>

        <!-- Currencies: its own form — the extra currencies prices are shown in (display only), each with a manual rate or the automatic one -->
        <form v-show="section === 'currencies'" class="space-y-6" @submit.prevent="saveCurrencies">
          <Card>
            <CardHeader>
              <CardTitle class="flex items-center gap-2"><Coins class="size-5" /> {{ t("online_store.section_currencies") }}</CardTitle>
              <CardDescription>{{ t("online_store.currencies_desc", { currency }) }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div v-if="currencies.currencies.length" class="divide-y rounded-xl border">
                <div v-for="(c, i) in currencies.currencies" :key="c.code" class="flex flex-wrap items-center gap-3 p-4" data-currency>
                  <div class="min-w-40 flex-1">
                    <p class="font-medium">{{ c.code }} <span class="font-normal text-muted-foreground">· {{ currencyName(c.code) }}</span></p>
                    <p class="text-xs text-muted-foreground">{{ autoRate(c.code) }}</p>
                  </div>
                  <InputGroup class="w-56">
                    <InputGroupAddon><InputGroupText>1 {{ currency }} =</InputGroupText></InputGroupAddon>
                    <InputGroupInput v-model="c.rate" type="number" step="any" min="0" inputmode="decimal" :placeholder="t('online_store.currency_rate_auto')" :aria-label="t('online_store.currency_rate_for', { code: c.code })" />
                    <InputGroupAddon align="inline-end"><InputGroupText>{{ c.code }}</InputGroupText></InputGroupAddon>
                  </InputGroup>
                  <WithTooltip :label="t('online_store.currency_remove', { code: c.code })"><Button type="button" size="icon" variant="ghost" :aria-label="t('online_store.currency_remove', { code: c.code })" @click="removeCurrency(c.code)"><Trash2 /></Button></WithTooltip>
                  <p v-if="(currencies.errors as Record<string, string>)[`currencies.${i}.rate`]" class="w-full text-sm text-destructive">{{ (currencies.errors as Record<string, string>)[`currencies.${i}.rate`] }}</p>
                </div>
              </div>
              <p v-else class="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{{ t("online_store.currencies_none") }}</p>
              <div class="flex flex-wrap items-center gap-2">
                <CurrencySelect id="add-currency" v-model="addingCurrency" class="w-64" />
                <Button type="button" variant="outline" :disabled="!addingCurrency" @click="addCurrency"><Plus /> {{ t("online_store.currency_add") }}</Button>
              </div>
              <p v-if="currencies.errors.currencies" class="text-sm text-destructive">{{ currencies.errors.currencies }}</p>
              <p class="text-xs text-muted-foreground">
                {{ t("online_store.currencies_hint") }}
                <template v-if="settings.exchange.fetched_at"> {{ t("online_store.currencies_updated", { date: fmtDate(settings.exchange.fetched_at) }) }}</template>
              </p>
            </CardContent>
          </Card>
          <div class="flex justify-end">
            <Button type="submit" :disabled="currencies.processing">
              <Loader2 v-if="currencies.processing" class="animate-spin" /> {{ t("online_store.save_currencies") }}
            </Button>
          </div>
        </form>

        <!-- A shipping zone: new or edited in place; Save persists the Delivery form (the table shows what is saved) -->
        <Dialog :open="!!zoneDialog" @update:open="(o: boolean) => !o && closeZone()">
          <DialogContent v-if="zoneDialog" class="sm:max-w-[38rem]">
            <form class="contents" @submit.prevent="saveZone">
              <DialogHeader>
                <DialogTitle>{{ zoneDialog.index === null ? t("online_store.new_zone") : t("online_store.edit_zone") }}</DialogTitle>
                <DialogDescription>{{ t("online_store.zone_dialog_desc") }}</DialogDescription>
              </DialogHeader>
              <div class="space-y-4">
                <div class="grid gap-2">
                  <Label for="zone-name">{{ t("online_store.zone_name") }}</Label>
                  <Input id="zone-name" v-model="zoneDialog.zone.name" :placeholder="t('online_store.zone_name_placeholder')" maxlength="60" />
                </div>
                <div class="grid gap-2">
                  <Label for="zone-countries">{{ t("online_store.countries") }}</Label>
                  <ChipPicker id="zone-countries" v-model="zoneDialog.zone.countries" :label="t('online_store.countries')" :options="COUNTRY_NAMES" :placeholder="t('online_store.zone_countries_placeholder')" :search-placeholder="t('online_store.search_country')" :hint="t('online_store.no_country_found')" />
                </div>
                <div class="grid gap-2">
                  <Label for="zone-states">{{ t("online_store.states") }} <span class="font-normal text-muted-foreground">{{ t("online_store.optional_paren") }}</span></Label>
                  <ChipPicker id="zone-states" v-model="zoneDialog.zone.states" :label="t('online_store.states')" :find="(q: string) => findPlaces(zoneDialog!.zone.countries, q, 'states')" custom :placeholder="t('online_store.states_placeholder')" :search-placeholder="t('online_store.search_state')" :hint="t('online_store.states_hint')" />
                  <p class="text-xs text-muted-foreground">{{ t("online_store.states_note") }}</p>
                </div>
                <div class="grid gap-2">
                  <Label for="zone-cities">{{ t("online_store.cities") }} <span class="font-normal text-muted-foreground">{{ t("online_store.optional_paren") }}</span></Label>
                  <ChipPicker id="zone-cities" v-model="zoneDialog.zone.cities" :label="t('online_store.cities')" :find="(q: string) => findPlaces(zoneDialog!.zone.countries, q)" custom :placeholder="t('online_store.cities_placeholder')" :search-placeholder="t('online_store.search_city')" :hint="t('online_store.cities_hint')" />
                  <p class="text-xs text-muted-foreground">{{ t("online_store.cities_note") }}</p>
                </div>
                <div class="grid gap-4 sm:grid-cols-2">
                  <div class="grid content-start gap-2">
                    <Label for="zone-fee">{{ t("online_store.delivery_price") }}</Label>
                    <InputGroup>
                      <InputGroupAddon><InputGroupText>{{ currencySymbol(currency) }}</InputGroupText></InputGroupAddon>
                      <InputGroupInput id="zone-fee" v-model="zoneDialog.zone.fee" inputmode="decimal" placeholder="0.00" />
                    </InputGroup>
                  </div>
                  <div class="grid content-start gap-2">
                    <Label for="zone-free">{{ t("online_store.free_delivery_from") }}</Label>
                    <InputGroup>
                      <InputGroupAddon><InputGroupText>{{ currencySymbol(currency) }}</InputGroupText></InputGroupAddon>
                      <InputGroupInput id="zone-free" v-model="zoneDialog.zone.free_delivery_min" inputmode="decimal" :placeholder="t('online_store.no_threshold')" />
                    </InputGroup>
                    <p class="text-xs text-muted-foreground">{{ t("online_store.free_from_hint") }}</p>
                  </div>
                </div>
                <p v-if="zoneError" class="text-sm text-destructive">{{ zoneError }}</p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" @click="closeZone">{{ t("common.cancel") }}</Button>
                <Button type="submit" :disabled="delivery.processing"><Loader2 v-if="delivery.processing" class="animate-spin" /> {{ t("online_store.save_zone") }}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <!-- Manual option settings: edits the same settings form; its Save (or "Save settings" outside) sends everything up -->
        <Dialog :open="!!current" @update:open="(o: boolean) => !o && (open = null)">
          <DialogContent v-if="current">
            <DialogHeader>
              <DialogTitle>{{ current.label }}</DialogTitle>
              <DialogDescription>
                {{ t("online_store.manual_desc") }} {{ current.fields.length ? t("online_store.manual_shown_to_buyer") : t("extensions.nothing_to_set_up") }}
              </DialogDescription>
            </DialogHeader>
            <form class="grid gap-4" @submit.prevent="save">
              <div v-for="f in current.fields" :key="f.name" class="grid gap-2">
                <div class="flex items-center gap-2">
                  <Label :for="`${current.key}-${f.name}`">{{ f.label }}</Label>
                  <Badge v-if="f.secret && isSet(current.key, f.name)" variant="outline" class="border-emerald-300 text-emerald-700 dark:text-emerald-400">{{ t("extensions.saved_badge") }}</Badge>
                </div>
                <!-- a fixed list is a dropdown; everything else is typed (`current!`: the v-if narrowing does not reach into the handler closure) -->
                <Select v-if="f.options" :model-value="form.credentials[current.key]![f.name] || undefined" @update:model-value="(v) => (form.credentials[current!.key]![f.name] = String(v ?? ''))">
                  <SelectTrigger :id="`${current.key}-${f.name}`" class="w-full" :aria-label="`${current.label} ${f.label}`" :aria-invalid="!!form.errors[`credentials.${current.key}.${f.name}`]"><SelectValue :placeholder="t('extensions.choose')" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
                  </SelectContent>
                </Select>
                <!-- bank details and the like: a few lines the buyer reads -->
                <Textarea v-else-if="f.multiline" :id="`${current.key}-${f.name}`" v-model="form.credentials[current.key]![f.name]" rows="4" :aria-label="`${current.label} ${f.label}`" :placeholder="f.placeholder" :aria-invalid="!!form.errors[`credentials.${current.key}.${f.name}`]" />
                <Input v-else :id="`${current.key}-${f.name}`" v-model="form.credentials[current.key]![f.name]" :type="f.secret ? 'password' : 'text'"
                  :aria-label="`${current.label} ${f.label}`"
                  :placeholder="f.secret && isSet(current.key, f.name) ? t('extensions.keep_blank') : f.placeholder"
                  autocomplete="off" :aria-invalid="!!form.errors[`credentials.${current.key}.${f.name}`]" />
                <p v-if="form.errors[`credentials.${current.key}.${f.name}`]" class="text-sm text-destructive">{{ form.errors[`credentials.${current.key}.${f.name}`] }}</p>
              </div>
              <DialogFooter>
                <Button type="submit" :disabled="form.processing"><Loader2 v-if="form.processing" class="animate-spin" /> {{ t("common.save") }}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <!-- Custom pages (About, Terms, FAQ, … — built in the GrapesJS editor, linked in the storefront footer) -->
        <Card v-show="section === 'pages'">
          <CardHeader class="flex flex-row items-start justify-between gap-3 space-y-0">
            <div class="space-y-1.5">
              <CardTitle class="flex items-center gap-2"><FileText class="size-5" /> {{ t("online_store.pages") }}</CardTitle>
              <CardDescription>{{ t("online_store.pages_desc") }}</CardDescription>
            </div>
            <Button as-child size="sm">
              <Link href="/online-store/pages/create"><Plus /> {{ t("online_store.new_page") }}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <p v-if="!pages.length" class="text-sm text-muted-foreground">{{ t("online_store.no_pages") }}</p>
            <ul v-else class="divide-y">
              <li v-for="p in pages" :key="p.id" class="flex items-center justify-between gap-3 py-2.5">
                <div class="min-w-0">
                  <p class="truncate font-medium">{{ p.title }}</p>
                  <a :href="`${publicUrl}/pages/${p.slug}`" target="_blank" rel="noopener" class="text-xs text-muted-foreground hover:underline">/pages/{{ p.slug }}</a>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <Button as-child variant="outline" size="sm">
                    <Link :href="`/online-store/pages/${p.id}/edit`" :aria-label="t('online_store.edit_page_aria', { title: p.title })"><Pencil /> {{ t("common.edit") }}</Link>
                  </Button>
                  <AlertDialog>
                    <WithTooltip :label="t('online_store.delete_page_aria', { title: p.title })">
                      <AlertDialogTrigger as-child>
                        <Button variant="ghost" size="icon" :aria-label="t('online_store.delete_page_aria', { title: p.title })"><Trash2 /></Button>
                      </AlertDialogTrigger>
                    </WithTooltip>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{{ t("online_store.delete_page_title", { title: p.title }) }}</AlertDialogTitle>
                        <AlertDialogDescription>{{ t("online_store.delete_page_desc") }}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
                        <AlertDialogAction @click="destroyPage(p)">{{ t("common.delete") }}</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <!-- section rail: docs-style hairline with an accent marker, deliberately unlike the app sidebar -->
      <nav :aria-label="t('online_store.sections_aria')" class="order-1 shrink-0 md:order-2 md:w-40 md:pt-1">
        <p class="mb-2 hidden text-xs font-medium tracking-widest text-muted-foreground/70 uppercase md:block">{{ t("online_store.manage") }}</p>
        <ul class="flex gap-4 overflow-x-auto border-b md:sticky md:top-6 md:flex-col md:gap-0 md:border-b-0 md:border-l">
          <li v-for="s in sections" :key="s.key">
            <button type="button" :aria-current="section === s.key ? 'true' : undefined"
              class="-mb-px block border-b-2 px-1 pb-2 text-sm whitespace-nowrap transition-colors md:-ml-px md:border-b-0 md:border-l-2 md:px-3 md:py-1.5"
              :class="section === s.key ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
              @click="section = s.key">{{ t(s.label) }}</button>
          </li>
        </ul>
      </nav>
    </div>
  </div>
</template>
