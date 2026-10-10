<script setup lang="ts">
import { Link } from "@inertiajs/vue3";
import { BarChart3, Globe, ShoppingCart } from "@lucide/vue";
import AppLogo from "@/components/AppLogo.vue";
import { EYEBROW, FOCUS } from "@/components/home/classes";
import { t } from "@/lib/i18n";

/**
 * The frame of every page a person sees before they are in the app:
 * sign in, create an account, accept an invitation, confirm the email.
 * Left, on wide screens: the brand panel, in the look of the front page (fixed colours).
 * Right: the page's own content, in the app's light or dark mode.
 * `wide` gives a long form more room.
 */
defineProps<{ wide?: boolean }>();

/** The three points on the brand panel. */
const FEATURES = [
	{ icon: ShoppingCart, key: "nav.login_feature_pos" },
	{ icon: Globe, key: "nav.login_feature_store" },
	{ icon: BarChart3, key: "nav.login_feature_reports" },
] as const;

/** The logo with the name: a link to the front page. */
const BRAND = `flex items-center gap-[9px] self-start rounded-sm ${FOCUS}`;
const NAME = "font-bricolage leading-none font-bold tracking-[-0.03em]";
</script>

<template>
  <div class="grid min-h-screen bg-background lg:grid-cols-2">
    <!-- Brand panel: wide screens only. It stays in place while a long form scrolls. -->
    <aside
      class="relative hidden overflow-hidden border-r border-[#1f1c16] bg-[#0b0a08] bg-[radial-gradient(70%_55%_at_85%_10%,rgba(245,193,59,0.22),rgba(245,193,59,0)_70%),radial-gradient(80%_50%_at_10%_105%,rgba(245,193,59,0.16),rgba(245,193,59,0)_70%)] p-12 font-figtree text-[#fbf8f1] antialiased lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col"
    >
      <Link href="/" :class="BRAND">
        <AppLogo class="size-8" />
        <span :class="[NAME, 'text-[24px]']">sellrika</span>
      </Link>

      <div class="mt-auto flex max-w-[480px] flex-col gap-6">
        <span :class="EYEBROW">{{ t("home.eyebrow") }}</span>
        <h2 class="font-bricolage text-[clamp(40px,4.4vw,60px)] leading-[0.98] font-extrabold tracking-[-0.045em] text-balance">
          {{ t("home.headline") }} <span class="text-[#f5c13b]">{{ t("home.headline_mark") }}</span>
        </h2>
        <p class="text-[18px] leading-normal text-pretty text-[#c9c1ae]">{{ t("nav.login_brand_sub") }}</p>
        <ul class="mt-2 flex flex-col gap-3">
          <li v-for="f in FEATURES" :key="f.key" class="flex items-center gap-3 text-[15px] font-medium text-[#e8e2d4]">
            <span class="grid size-9 place-items-center rounded-[10px] bg-[#f5c13b]/16 text-[#f5c13b]" aria-hidden="true">
              <component :is="f.icon" class="size-4" />
            </span>
            {{ t(f.key) }}
          </li>
        </ul>
      </div>
    </aside>

    <main class="flex items-center justify-center p-6 sm:p-12">
      <div class="w-full" :class="wide ? 'max-w-md' : 'max-w-sm'">
        <!-- the logo moves here when the brand panel is hidden -->
        <Link href="/" :class="[BRAND, 'mb-10 lg:hidden']">
          <AppLogo class="size-8" />
          <span :class="[NAME, 'text-[24px]']">sellrika</span>
        </Link>
        <slot />
      </div>
    </main>
  </div>
</template>
