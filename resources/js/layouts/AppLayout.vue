<script setup lang="ts">
import AppLogo from "@/components/AppLogo.vue";
import { Link, router, usePage } from "@inertiajs/vue3";
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useColorMode } from "@vueuse/core";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
	ShoppingCart,
	Package,
	Tags,
	TicketPercent,
	Megaphone,
	ReceiptText,
	CreditCard,
	ChevronDown,
	ChevronRight,
	ChevronsUpDown,
	LogOut,
	Star,
	Check,
	Settings,
	PanelLeft,
	Users,
	Contact,
	Boxes,
	BarChart3,
	Menu,
	Sun,
	Moon,
	Monitor,
	SunMoon,
	Settings2,
	Globe,
	MapPin,
	Coins,
	User,
	Mail,
	Puzzle,
	KeyRound,
	Search as SearchIcon,
	Minimize,
	Languages,
} from "@lucide/vue";
import type { SharedProps } from "@/types";
import ShopLogo from "@/components/ShopLogo.vue";
import { useGlobalSearch } from "@/lib/search";
import { t } from "@/lib/i18n";
import { keepFullscreen, maximized, toggleMaximized } from "@/lib/fullscreen";
import { LOCALES, type Locale } from "@i18n";

const page = usePage<SharedProps>();
const user = computed(() => page.props.auth.user);
const shop = computed(() => page.props.shop);
const shops = computed(() => page.props.shops);
/** What an add-on says about the account's plan. Null = nothing. */
const plan = computed(() => page.props.plan);

/** The extension page on screen, with what its manifest asked for. */
const extPage = computed(
	() =>
		(page.props as { page?: { fullscreen?: boolean; breadcrumb?: boolean } })
			.page,
);
// maximized (the Full screen button): the browser drops full screen now and then, a click takes it back
onMounted(function watchClicks() {
	window.addEventListener("click", keepFullscreen, true);
	window.addEventListener("afterprint", keepFullscreen);
});
onBeforeUnmount(function stopClicks() {
	window.removeEventListener("click", keepFullscreen, true);
	window.removeEventListener("afterprint", keepFullscreen);
});

// collapsed state survives reloads (per browser)
const collapsed = ref(localStorage.getItem("sidebar") === "collapsed");
watch(collapsed, (v) =>
	localStorage.setItem("sidebar", v ? "collapsed" : "open"),
);

// light | dark | auto (follows the OS); stored in localStorage, toggles `.dark` on <html> (app.edge pre-applies it before paint)
const theme = useColorMode({ emitAuto: true });
const themes = [
	{ value: "light", label: "nav.theme_light", icon: Sun },
	{ value: "dark", label: "nav.theme_dark", icon: Moon },
	{ value: "auto", label: "nav.theme_system", icon: Monitor },
] as const;

/** The language switcher: the server sets the `lang` cookie and sends the page back translated. */
function setLocale(value: unknown) {
	router.post("/lang", { locale: String(value) });
}
function langLabel(l: Locale) {
	return t(`lang.${l}`);
}

// ⌘K palette: pages, settings sections and this shop's records (resources/js/lib/search.ts)
const search = useGlobalSearch();
const isAdmin = computed(() => user.value?.role === "admin");
// managers see the catalog, payments, marketing, reports and staff too
const isManager = computed(
	() => isAdmin.value || user.value?.role === "manager",
);
// the ADMIN_EMAIL user: the only one who sees the platform settings (Addresses)
const isPlatform = computed(() => !!user.value?.platform);
/** The Admin section's tile: the same square as the others, but almost see-through. */
const ADMIN_TILE = "bg-foreground/10 text-foreground";
// cashiers see only what they can use; the server enforces the same split (admin middleware)
const allNav = [
	{
		href: "/pos",
		key: "nav.sell",
		icon: ShoppingCart,
		admin: false,
		group: "",
	},
	{
		href: "/reports",
		key: "nav.reports",
		icon: BarChart3,
		color: "bg-indigo-500",
		admin: false,
		manager: true,
		group: "Sales",
	},
	{
		href: "/orders",
		key: "nav.orders",
		icon: ReceiptText,
		color: "bg-blue-500",
		admin: false,
		group: "Sales",
	},
	{
		href: "/customers",
		key: "nav.customers",
		icon: Contact,
		color: "bg-violet-500",
		admin: false,
		group: "Sales",
	},
	{
		href: "/coupons",
		key: "nav.coupons",
		icon: TicketPercent,
		color: "bg-pink-500",
		admin: true,
		group: "Sales",
	},
	{
		href: "/marketing",
		key: "nav.marketing",
		icon: Megaphone,
		color: "bg-orange-500",
		admin: false,
		manager: true,
		group: "Sales",
	},
	{
		href: "/products",
		key: "nav.products",
		icon: Package,
		color: "bg-amber-500",
		admin: false,
		manager: true,
		group: "Catalog",
	},
	{
		href: "/stock",
		key: "nav.stock",
		icon: Boxes,
		color: "bg-teal-500",
		admin: false,
		manager: true,
		group: "Catalog",
	},
	{
		href: "/categories",
		key: "nav.categories",
		icon: Tags,
		color: "bg-rose-500",
		admin: false,
		manager: true,
		group: "Catalog",
	},
	{
		href: "/payment-methods",
		key: "nav.payments",
		icon: CreditCard,
		color: "bg-green-600",
		admin: false,
		manager: true,
		group: "Catalog",
	},
	{
		href: "/online-store",
		key: "nav.online_store",
		icon: Globe,
		color: "bg-sky-500",
		admin: true,
		group: "Settings",
	},
	{
		href: "/users",
		key: "nav.staff",
		icon: Users,
		color: "bg-purple-500",
		admin: false,
		manager: true,
		group: "Settings",
	},
	{
		href: "/extensions",
		key: "nav.extensions",
		icon: Puzzle,
		color: "bg-fuchsia-500",
		admin: true,
		group: "Settings",
	},
	{
		href: "/shop-email",
		key: "nav.shop_email",
		icon: Mail,
		color: "bg-indigo-500",
		admin: true,
		group: "Settings",
	},
	{
		href: "/api-keys",
		key: "nav.api_keys",
		icon: KeyRound,
		color: "bg-slate-600",
		admin: true,
		group: "Settings",
	},
	// Admin: the platform-level pages, in a section of their own at the end (faint tiles)
	{
		href: "/owners",
		key: "nav.owners",
		icon: User,
		color: ADMIN_TILE,
		admin: true,
		platform: true,
		group: "Admin",
	},
	{
		href: "/email",
		key: "nav.outgoing_email",
		icon: Mail,
		color: ADMIN_TILE,
		admin: true,
		platform: true,
		group: "Admin",
	},
	{
		href: "/admin/extensions",
		key: "nav.global_extensions",
		icon: Puzzle,
		color: ADMIN_TILE,
		admin: true,
		platform: true,
		group: "Admin",
	},
	{
		href: "/postal-codes",
		key: "nav.postal_codes",
		icon: MapPin,
		color: ADMIN_TILE,
		admin: true,
		platform: true,
		group: "Admin",
	},
	{
		href: "/exchange-rates",
		key: "nav.exchange_rates",
		icon: Coins,
		color: ADMIN_TILE,
		admin: true,
		platform: true,
		group: "Admin",
	},
] as const;
/** A sidebar section heading: our own sections are translated, an extension's own name is shown as it is. */
function groupLabel(group: string) {
	if (group === "Sales") return t("nav.group_sales");
	if (group === "Catalog") return t("nav.group_catalog");
	if (group === "Settings") return t("nav.group_settings");
	if (group === "Extensions") return t("nav.group_extensions");
	if (group === "Admin") return t("nav.group_admin");
	return group;
}
// the running extensions' own pages (shared prop, already filtered by role on the server) join the sidebar section their manifest names ("Catalog", …; "Extensions" by default)
/** An extension's logo as a sidebar icon: an <img> that takes the same classes the lucide icons get. */
const logo = (src: string) => () =>
	h("img", { src, alt: "", class: "rounded-md object-contain" });
/** The app's links the running extensions hide (manifest `hide_nav`): only the link goes, the page still opens. */
const hiddenNav = computed(
	() =>
		new Set((page.props.extension_ui ?? []).flatMap((e) => e.hide_nav ?? [])),
);
const extensionNav = computed(() =>
	(page.props.extension_ui ?? []).flatMap((e) =>
		e.pages.map((p) => ({
			href: p.href,
			label: p.title,
			icon: p.icon ? logo(p.icon) : Puzzle,
			// a logo keeps its own colours; the fallback puzzle gets a grey tile
			color: p.icon ? "" : "bg-slate-500",
			// a logo fills the whole tile, like the coloured squares
			logo: !!p.icon,
			admin: false,
			group: p.group,
			before: p.before,
		})),
	),
);
const nav = computed(() => [
	...allNav
		.filter(
			(n) =>
				(!n.admin || isAdmin.value) &&
				(!("manager" in n) || isManager.value) &&
				(!("platform" in n) || isPlatform.value) &&
				!hiddenNav.value.has(n.href),
		)
		.map(function labelled(n) {
			return {
				href: n.href as string,
				label: t(n.key),
				icon: n.icon,
				color: ("color" in n ? n.color : "") as string,
				admin: n.admin,
				group: n.group as string,
			};
		}),
	...extensionNav.value,
]);
// same list, split into labelled sections (empty groups drop out for cashiers)
const navGroups = computed(function sections() {
	const groups = [
		...new Map(nav.value.map((n) => [n.group, n.group])).keys(),
	].map((group) => ({
		group,
		items: nav.value.filter((n) => n.group === group),
	}));
	// an extension's own section may ask for a place above an app section (`group_before`)
	for (const e of extensionNav.value) {
		const at = groups.findIndex((g) => g.group === e.group);
		const target = groups.findIndex((g) => g.group === e.before);
		if (!e.before || at < 0 || target < 0 || at < target) continue;
		groups.splice(target, 0, ...groups.splice(at, 1));
	}
	return groups;
});
const matches = (href: string) =>
	page.url === href ||
	page.url.startsWith(`${href}/`) ||
	page.url.startsWith(`${href}?`);
// the longest matching link wins: an extension's page (/extensions/<key>/<path>) lights its own link, not Extensions
const isActive = (href: string) =>
	matches(href) &&
	!nav.value.some(
		(n) => n.href !== href && n.href.startsWith(`${href}/`) && matches(n.href),
	);
/** The sidebar link this page sits under (the same one `isActive` lights). */
const section = computed(() => nav.value.find((n) => isActive(n.href)));
// the page's own <Head> title, read back from the document (the layout stays mounted across visits)
const pageTitle = ref("");
/** Copy the document title without the " · Sellrika" suffix app.ts adds. */
function readTitle() {
	pageTitle.value = document.title.replace(/ · Sellrika$/, "");
}
onMounted(function watchTitle() {
	readTitle();
	const observer = new MutationObserver(readTitle);
	observer.observe(document.head, {
		subtree: true,
		childList: true,
		characterData: true,
	});
	onBeforeUnmount(function stopWatching() {
		observer.disconnect();
	});
});
/** Group › section › page; the page part only when it is not the section itself. */
const crumbs = computed(() => {
	const s = section.value;
	const title = pageTitle.value;
	const leaf = title && title !== "Sellrika" && title !== s?.label ? title : "";
	return [
		s?.group ? { label: groupLabel(s.group) } : null,
		s ? { label: s.label, href: leaf ? s.href : undefined } : null,
		leaf ? { label: leaf } : null,
	].filter((c): c is { label: string; href?: string } => !!c);
});
const lowStock = computed(() => page.props.low_stock ?? 0);
const initials = computed(() =>
	(user.value?.name ?? "?")
		.split(" ")
		.map((p) => p[0])
		.join("")
		.slice(0, 2)
		.toUpperCase(),
);
</script>

<template>
  <!-- disable-hoverable-content: no grace area, so a quick sweep down the collapsed rail can't leave tooltips stuck open -->
  <TooltipProvider :delay-duration="0" disable-hoverable-content>
  <div class="flex h-screen w-full overflow-hidden bg-muted/30 text-foreground">
    <!-- Sidebar -->
    <aside v-show="!maximized" class="hidden shrink-0 flex-col border-r bg-background transition-[width] duration-200 md:flex" :class="collapsed ? 'w-16' : 'w-60'">
      <!-- Shop switcher (doubles as the sidebar header) -->
      <div class="flex h-14 items-center gap-1" :class="collapsed ? 'justify-center px-0' : 'pl-2 pr-1'">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" class="h-auto gap-2 py-1.5" :class="collapsed ? 'justify-center px-0' : 'min-w-0 flex-1 justify-start px-1.5'" :aria-label="t('nav.shop_aria', { name: shop?.name ?? '' })" :title="collapsed ? shop?.name : undefined">
              <ShopLogo :shop="shop" class="size-7 shrink-0" />
              <template v-if="!collapsed">
                <span class="min-w-0 flex-1 truncate text-left text-sm font-semibold">{{ shop?.name ?? t("nav.no_shop") }}</span>
                <ChevronsUpDown class="size-4 shrink-0 opacity-60" />
              </template>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-56" align="start" :side="collapsed ? 'right' : 'bottom'">
            <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">{{ t("nav.switch_shop") }}</DropdownMenuLabel>
            <DropdownMenuItem v-for="s in shops" :key="s.id" class="gap-2 py-2" @select="router.post(`/shops/${s.id}/switch`)">
              <ShopLogo :shop="s" class="size-6 shrink-0" />
              <span class="min-w-0 flex-1 truncate text-sm" :class="s.id === shop?.id && 'font-medium'">{{ s.name }}</span>
              <Check v-if="s.id === shop?.id" class="size-4 shrink-0 text-primary" />
            </DropdownMenuItem>
            <template v-if="isAdmin">
              <DropdownMenuSeparator />
              <DropdownMenuItem as-child><Link href="/shops"><Settings2 class="size-4" /> {{ t("nav.manage_shops") }}</Link></DropdownMenuItem>
            </template>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <!-- global search: looks like an input, opens the ⌘K palette -->
      <div class="pb-2" :class="collapsed ? 'px-2' : 'px-3'">
        <Tooltip>
          <TooltipTrigger as-child>
            <button type="button" :aria-label="t('nav.search')" :aria-keyshortcuts="'Meta+K Control+K'"
              class="flex items-center gap-2 rounded-lg text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              :class="collapsed ? 'mx-auto size-9 justify-center bg-muted/60' : 'h-8 w-full bg-muted/60 px-2.5'" @click="search.open()">
              <SearchIcon class="size-4 shrink-0" />
              <template v-if="!collapsed">
                <span class="flex-1 text-left">{{ t("nav.search") }}</span>
                <kbd class="rounded border bg-background px-1.5 font-sans leading-4 text-[10px] font-medium">⌘K</kbd>
              </template>
            </button>
          </TooltipTrigger>
          <TooltipContent v-if="collapsed" side="right">{{ t("nav.search_shortcut") }}</TooltipContent>
        </Tooltip>
      </div>

      <nav class="flex-1 overflow-y-auto pb-2" :class="collapsed ? 'px-2' : 'px-3'">
        <div v-for="(g, gi) in navGroups" :key="g.group" class="space-y-0.75" :class="gi > 0 && (collapsed ? 'mt-2 border-t pt-2' : 'mt-3.5')">
        <div v-if="g.group && !collapsed" class="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{{ groupLabel(g.group) }}</div>
        <Tooltip v-for="n in g.items" :key="n.href">
          <TooltipTrigger as-child>
            <Link :href="n.href"
              class="relative flex items-center gap-3 rounded-lg py-1.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              :class="[collapsed ? 'justify-center px-0' : 'px-3', isActive(n.href) ? 'bg-accent text-accent-foreground' : 'text-muted-foreground']"
              :aria-label="n.label">
              <span class="flex size-5 shrink-0 items-center justify-center rounded-md" :class="n.color && [n.color, !n.color.includes('text-') && 'text-white']">
                <component :is="n.icon" :class="n.color ? 'size-3.5' : 'logo' in n && n.logo ? 'size-5' : 'size-4'" />
              </span>
              <span v-if="!collapsed">{{ n.label }}</span>
              <template v-if="n.href === '/stock' && lowStock > 0">
                <span v-if="!collapsed" data-testid="stock-badge" class="ml-auto rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white tabular-nums">{{ lowStock }}</span>
                <span v-else class="absolute right-2.5 top-1.5 size-2 rounded-full bg-destructive" aria-hidden="true"></span>
              </template>
            </Link>
          </TooltipTrigger>
          <TooltipContent v-if="collapsed" side="right">{{ n.label }}</TooltipContent>
        </Tooltip>
        </div>
      </nav>

      <!-- the user menu + the collapse toggle (beside it when open, above it when collapsed) -->
      <div class="flex items-center gap-1.5 p-2" :class="collapsed ? 'flex-col-reverse' : 'px-3'">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button type="button" class="flex items-center gap-2 rounded-full border bg-muted/40 p-1 text-[13px] font-medium transition-colors hover:bg-accent" :class="!collapsed && 'min-w-0 flex-1 pr-3'" :aria-label="user?.name" :title="t(`nav.${user?.role ?? 'cashier'}`)">
              <Avatar class="size-6 shrink-0"><AvatarFallback class="text-[11px] font-semibold">{{ initials.slice(0, 1) }}</AvatarFallback></Avatar>
              <template v-if="!collapsed">
                <span class="min-w-0 flex-1 truncate text-left">{{ user?.name }}</span>
                <ChevronDown class="size-3.5 shrink-0 opacity-60" />
              </template>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-52" :side="collapsed ? 'right' : 'top'" align="start">
            <DropdownMenuLabel class="font-normal">
              <div class="text-sm font-medium">{{ user?.name }}</div>
              <div class="text-xs text-muted-foreground">{{ user?.email }}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem as-child><Link href="/settings"><Settings class="size-4" /> {{ t("nav.settings") }}</Link></DropdownMenuItem>
            <DropdownMenuItem v-if="plan?.href" as-child><Link :href="plan.href"><CreditCard class="size-4" /> {{ plan.menu }}</Link></DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><SunMoon class="size-4" /> {{ t("nav.theme") }}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup v-model="theme">
                  <DropdownMenuRadioItem v-for="th in themes" :key="th.value" :value="th.value"><component :is="th.icon" class="size-4" /> {{ t(th.label) }}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Languages class="size-4" /> {{ t("common.language") }}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup :model-value="page.props.locale" @update:model-value="setLocale">
                  <DropdownMenuRadioItem v-for="l in LOCALES" :key="l" :value="l">{{ langLabel(l) }}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem as-child><a href="https://github.com/sellrika/sellrika" target="_blank" rel="noopener"><Star class="size-4" /> {{ t("nav.star_us") }}</a></DropdownMenuItem>
            <DropdownMenuItem @select="router.post('/logout')"><LogOut class="size-4" /> {{ t("nav.logout") }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon-sm" class="shrink-0 text-muted-foreground" :aria-label="t(collapsed ? 'nav.expand_sidebar' : 'nav.collapse_sidebar')" @click="collapsed = !collapsed"><PanelLeft /></Button>
      </div>
    </aside>

    <!-- Main -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- Mobile top bar -->
      <header v-show="!maximized" class="flex h-14 items-center gap-2 border-b bg-background px-4 md:hidden">
        <AppLogo class="size-6" /><span class="font-semibold">Sellrika</span>
        <nav class="ml-auto flex gap-0.5">
          <button type="button" class="rounded-md p-2 hover:bg-accent" :aria-label="t('nav.search')" @click="search.open()"><SearchIcon class="size-5" /></button>
          <!-- the three everyday screens stay one tap away; the rest sits in a menu -->
          <Link v-for="n in nav.slice(0, 3)" :key="n.href" :href="n.href" class="rounded-md p-2 hover:bg-accent" :class="isActive(n.href) && 'bg-accent'"
            :aria-label="n.label"><component :is="n.icon" class="size-5" /></Link>
          <DropdownMenu v-if="nav.length > 3">
            <DropdownMenuTrigger as-child>
              <button type="button" class="rounded-md p-2 hover:bg-accent" :aria-label="t('nav.more_pages')"><Menu class="size-5" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-48" align="end">
              <DropdownMenuItem v-for="n in nav.slice(3)" :key="n.href" as-child>
                <Link :href="n.href" :class="isActive(n.href) && 'bg-accent'"><component :is="n.icon" class="size-4" /> {{ n.label }}</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
        <!-- Shop switch + logout (the sidebar is hidden here) -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button type="button" class="rounded-full" :aria-label="`${user?.name} · ${shop?.name}`">
              <Avatar class="size-8"><AvatarFallback class="text-xs">{{ initials }}</AvatarFallback></Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-56" align="end">
            <DropdownMenuLabel class="font-normal">
              <div class="truncate text-sm font-medium">{{ user?.name }}</div>
              <div class="truncate text-xs text-muted-foreground">{{ user?.email }}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{{ t("nav.switch_shop") }}</DropdownMenuLabel>
            <DropdownMenuItem v-for="s in shops" :key="s.id" @select="router.post(`/shops/${s.id}/switch`)">
              <ShopLogo :shop="s" class="size-5" />
              <span class="flex-1 truncate">{{ s.name }}</span>
              <Check class="size-4" :class="s.id === shop?.id ? 'opacity-100' : 'opacity-0'" />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem as-child><Link href="/settings"><Settings class="size-4" /> {{ t("nav.settings") }}</Link></DropdownMenuItem>
            <DropdownMenuItem v-if="plan?.href" as-child><Link :href="plan.href"><CreditCard class="size-4" /> {{ plan.menu }}</Link></DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><SunMoon class="size-4" /> {{ t("nav.theme") }}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup v-model="theme">
                  <DropdownMenuRadioItem v-for="th in themes" :key="th.value" :value="th.value"><component :is="th.icon" class="size-4" /> {{ t(th.label) }}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Languages class="size-4" /> {{ t("common.language") }}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup :model-value="page.props.locale" @update:model-value="setLocale">
                  <DropdownMenuRadioItem v-for="l in LOCALES" :key="l" :value="l">{{ langLabel(l) }}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem as-child><a href="https://github.com/sellrika/sellrika" target="_blank" rel="noopener"><Star class="size-4" /> {{ t("nav.star_us") }}</a></DropdownMenuItem>
            <DropdownMenuItem @select="router.post('/logout')"><LogOut class="size-4" /> {{ t("nav.logout") }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <!-- an add-on's line about the account's plan -->
      <p v-if="plan?.banner" role="status" class="flex shrink-0 flex-wrap items-center justify-center gap-x-2 border-b bg-primary/15 px-4 py-1.5 text-center text-sm">
        {{ plan.banner }}
        <Link v-if="plan.href" :href="plan.href" class="font-medium underline underline-offset-4">{{ plan.cta }}</Link>
      </p>
      <!-- no breadcrumb on Sell or an extension page that said `breadcrumb: false`: they need the whole height -->
      <nav v-if="crumbs.length && !isActive('/pos') && extPage?.breadcrumb !== false" :aria-label="t('nav.breadcrumb')" class="flex h-12 shrink-0 items-center border-b bg-background px-4 text-sm md:px-6">
        <ol class="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <li v-for="(c, i) in crumbs" :key="i" class="flex min-w-0 items-center gap-1.5">
            <ChevronRight v-if="i > 0" class="size-3.5 shrink-0" aria-hidden="true" />
            <Link v-if="c.href" :href="c.href" class="truncate hover:text-foreground">{{ c.label }}</Link>
            <span v-else class="truncate" :class="i === crumbs.length - 1 && 'font-medium text-foreground'" :aria-current="i === crumbs.length - 1 ? 'page' : undefined">{{ c.label }}</span>
          </li>
        </ol>
      </nav>
      <main class="min-h-0 flex-1 overflow-auto">
        <slot />
      </main>
      <!-- maximized on a page with no Full screen button of its own (an order, Tables): the way back -->
      <Button v-if="maximized && !extPage?.fullscreen && !isActive('/pos')" variant="outline" size="icon" class="fixed bottom-3 left-3 z-40 size-9 shadow-md" :aria-label="t('nav.fullscreen_exit')" :title="t('nav.fullscreen_exit')" data-fullscreen-toggle @click="toggleMaximized"><Minimize /></Button>
    </div>
    <Toaster rich-colors close-button position="top-right" :theme="theme === 'auto' ? 'system' : theme" />
  </div>
  </TooltipProvider>
</template>
