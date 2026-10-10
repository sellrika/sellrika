<script setup lang="ts">
import { ref } from "vue";
import { Head, Link, useForm, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import {
	ImagePlus,
	Loader2,
	Percent,
	Store,
	Trash2,
	UserPlus,
} from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import BackButton from "@/components/BackButton.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import CurrencySelect from "@/components/CurrencySelect.vue";
import TimezoneSelect from "@/components/TimezoneSelect.vue";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@/components/ui/input-group";
import { uploadImage } from "@/lib/upload";
import { t } from "@/lib/i18n";
import type { SharedProps, Shop } from "@/types";

defineOptions({ layout: AppLayout });
/** One page for both "New shop" (shop = null, /shops/create) and "Edit shop" (/shops/:id/edit). */
const props = defineProps<{ shop: Shop | null; timezones: string[] }>();
const s = props.shop;
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const defaultZone = props.timezones.includes(browserZone) ? browserZone : "UTC";

// the support email and delivery (country, prices, pick-up…) live on /online-store, not here
const form = useForm({
	name: s?.name ?? "",
	currency: s?.currency ?? "USD",
	timezone: s?.timezone ?? defaultZone,
	logo: s?.logo ?? null,
	tax_rate: String((s?.tax_rate ?? 0) / 100),
	tax_label: s?.tax_label ?? "Tax",
	tax_included: s?.tax_included ?? false,
	owner_email: "", // platform admin only: blank = my own shop, an email = a new owner gets it
});
// only the platform admin may create a shop for someone else, and only a new one
const canInvite = !s && !!usePage<SharedProps>().props.auth.user?.platform;
// the tax rate is typed as a percent (7.5) and sent in hundredths of a percent (750)
form.transform((d) => ({
	...d,
	tax_rate: Math.round(Number(d.tax_rate.trim() || 0) * 100),
}));

function submit() {
	const done = {
		onSuccess: () => toast.success(s ? t("shops.updated") : t("shops.created")),
	};
	s ? form.put(`/shops/${s.id}`, done) : form.post("/shops", done);
}

/* logo */
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const uploadError = ref("");
async function pick(e: Event) {
	const input = e.target as HTMLInputElement;
	const file = input.files?.[0];
	if (!file || uploading.value) return;
	uploading.value = true;
	uploadError.value = "";
	const r = await uploadImage(file, "logo", s?.id);
	if ("error" in r) uploadError.value = r.error;
	else form.logo = r.url;
	uploading.value = false;
	input.value = "";
}
</script>

<template>
  <Head :title="s ? t('shops.edit_head', { name: s.name }) : t('shops.new')" />

  <form class="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-6" @submit.prevent="submit">
    <!-- Header -->
    <div class="flex flex-wrap items-center gap-3">
      <BackButton href="/shops" :label="t('shops.back_aria')" />
      <div class="mr-auto">
        <h1 class="text-xl font-semibold tracking-tight">{{ s ? t("shops.edit_title") : t("shops.new") }}</h1>
        <p class="text-sm text-muted-foreground">{{ s ? t("shops.edit_sub") : t("shops.new_sub") }}</p>
      </div>
      <div class="ml-auto flex gap-2">
        <Button as-child variant="outline"><Link href="/shops">{{ t("common.cancel") }}</Link></Button>
        <Button type="submit" :disabled="form.processing || uploading">
          <Loader2 v-if="form.processing" class="animate-spin" />
          {{ s ? t("common.save") : t("shops.create") }}
        </Button>
      </div>
    </div>

    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><Store class="size-5" /> {{ t("shops.card_title") }}</CardTitle>
        <CardDescription>{{ t("shops.card_desc") }}</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-5">
        <!-- Logo + name -->
        <div class="flex items-start gap-4">
          <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" class="sr-only" @change="pick" />
          <button
            type="button"
            class="group relative size-20 shrink-0 overflow-hidden rounded-xl border bg-muted outline-none transition-colors hover:border-primary/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            :class="!form.logo && 'border-2 border-dashed border-input'"
            :aria-label="t('shops.upload_logo')"
            :disabled="uploading"
            @click="fileInput?.click()"
          >
            <img v-if="form.logo" :src="form.logo" :alt="t('shops.logo_preview')" class="size-full object-cover" />
            <span v-else class="flex size-full items-center justify-center text-muted-foreground"><Store class="size-8" /></span>
            <span class="absolute inset-0 flex items-center justify-center bg-background/70 text-foreground opacity-0 transition-opacity group-hover:opacity-100" :class="uploading && 'opacity-100'">
              <Loader2 v-if="uploading" class="size-5 animate-spin" />
              <ImagePlus v-else class="size-5" />
            </span>
          </button>
          <div class="grid min-w-0 flex-1 gap-2">
            <Label for="shop-name">{{ t("common.name") }}</Label>
            <Input id="shop-name" v-model="form.name" autofocus :placeholder="t('shops.name_placeholder')" :aria-invalid="!!form.errors.name" />
            <p v-if="form.errors.name" class="text-sm text-destructive">{{ form.errors.name }}</p>
            <p v-else-if="uploadError || form.errors.logo" class="text-sm text-destructive">{{ uploadError || form.errors.logo }}</p>
            <div v-else class="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{{ form.logo ? t("shops.logo_set") : t("shops.logo_none") }}</span>
              <button v-if="form.logo" type="button" class="inline-flex items-center gap-1 text-destructive hover:underline" @click="form.logo = null">
                <Trash2 class="size-3" /> {{ t("common.remove") }}
              </button>
            </div>
          </div>
        </div>

        <!-- Currency + time zone -->
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="shop-currency">{{ t("shops.currency") }}</Label>
            <CurrencySelect id="shop-currency" v-model="form.currency" :invalid="!!form.errors.currency" />
            <p v-if="form.errors.currency" class="text-sm text-destructive">{{ form.errors.currency }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="shop-timezone">{{ t("shops.timezone") }}</Label>
            <TimezoneSelect id="shop-timezone" v-model="form.timezone" :zones="timezones" :invalid="!!form.errors.timezone" />
            <p v-if="form.errors.timezone" class="text-sm text-destructive">{{ form.errors.timezone }}</p>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Tax / VAT — its own card with an anchor, so "Tax settings" in the ⌘K search lands right here -->
    <Card id="tax" class="scroll-mt-6">
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><Percent class="size-5" /> {{ t("shops.tax") }}</CardTitle>
        <CardDescription>{{ t("shops.tax_desc") }}</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid content-start gap-2">
            <Label for="shop-tax-rate">{{ t("shops.tax_rate") }}</Label>
            <InputGroup>
              <InputGroupInput id="shop-tax-rate" v-model="form.tax_rate" inputmode="decimal" placeholder="0" :aria-invalid="!!form.errors.tax_rate" />
              <InputGroupAddon align="inline-end"><InputGroupText>%</InputGroupText></InputGroupAddon>
            </InputGroup>
            <p v-if="form.errors.tax_rate" class="text-sm text-destructive">{{ form.errors.tax_rate }}</p>
            <p v-else class="text-xs text-muted-foreground">{{ t("shops.tax_rate_help") }}</p>
          </div>
          <div class="grid content-start gap-2">
            <Label for="shop-tax-label">{{ t("shops.tax_label") }}</Label>
            <Input id="shop-tax-label" v-model="form.tax_label" :placeholder="t('shops.tax_label_placeholder')" maxlength="20" :aria-invalid="!!form.errors.tax_label" />
            <p v-if="form.errors.tax_label" class="text-sm text-destructive">{{ form.errors.tax_label }}</p>
            <p v-else class="text-xs text-muted-foreground">{{ t("shops.tax_label_help") }}</p>
          </div>
        </div>
        <div class="flex items-start gap-3">
          <Switch id="shop-tax-included" v-model="form.tax_included" :aria-label="t('shops.tax_included')" />
          <div class="grid gap-1">
            <Label for="shop-tax-included">{{ t("shops.tax_included") }}</Label>
            <p class="text-xs text-muted-foreground">{{ t("shops.tax_included_help") }}</p>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card v-if="canInvite">
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><UserPlus class="size-5" /> {{ t("shops.owner_title") }}</CardTitle>
        <CardDescription>{{ t("shops.owner_desc") }}</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-2">
        <Label for="shop-owner-email">{{ t("shops.owner_email") }}</Label>
        <Input id="shop-owner-email" v-model="form.owner_email" type="email" autocomplete="off" :aria-invalid="!!form.errors.owner_email" />
        <p v-if="form.errors.owner_email" class="text-sm text-destructive">{{ form.errors.owner_email }}</p>
      </CardContent>
    </Card>
  </form>
</template>
