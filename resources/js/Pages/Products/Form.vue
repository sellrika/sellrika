<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Head, Link, useForm, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import AppLayout from "@/layouts/AppLayout.vue";
import BackButton from "@/components/BackButton.vue";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import ExtensionSlot from "@/components/ExtensionSlot.vue";
import RichText from "@/components/RichText.vue";
import { Switch } from "@/components/ui/switch";
import ImagesUpload from "@/components/products/ImagesUpload.vue";
import CategoryPicker from "@/components/products/CategoryPicker.vue";
import VariantsEditor from "@/components/products/VariantsEditor.vue";
import BundleItemsEditor, {
	type BundleRow,
} from "@/components/products/BundleItemsEditor.vue";
import UnitSelect from "@/components/products/UnitSelect.vue";
import ShareDialog from "@/components/products/ShareDialog.vue";
import {
	Boxes,
	PackageOpen,
	Plus,
	ScanBarcode,
	Share2,
	Tag,
	Trash2,
} from "@lucide/vue";
import { currencySymbol as symbolOf, fromCents, toCents } from "@/lib/format";
import { t } from "@/lib/i18n";
import type {
	Category,
	PackageComponent,
	Product,
	ProductExtra,
	SharedProps,
} from "@/types";

defineOptions({ layout: AppLayout });
/** `components` = every ordinary product of the shop — what a package may be built from. */
const props = defineProps<{
	product: Product | null;
	categories: Category[];
	components: PackageComponent[];
}>();

const page = usePage<SharedProps>();
const currency = computed(() => page.props.shop?.currency ?? "USD");
const currencySymbol = computed(() => symbolOf(currency.value));

const p = props.product;
/** The Share dialog: a saved, active product of a shop whose online store is on. */
const sharing = ref(false);
const canShare = computed(
	() =>
		!!p?.active && !!page.props.shop?.online_enabled && !!page.props.shop.slug,
);
const form = useForm({
	name: p?.name ?? "",
	description: p?.description ?? "",
	price: p ? fromCents(p.price) : "",
	purchase_price: p?.purchase_price != null ? fromCents(p.purchase_price) : "",
	original_price: p?.original_price != null ? fromCents(p.original_price) : "",
	images: [...(p?.images ?? [])] as string[],
	sku: p?.sku ?? "",
	barcode: p?.barcode ?? "",
	unit: p?.unit ?? "",
	amount: p?.amount != null ? String(p.amount) : "",
	extra: (p?.extra ?? []).map((r) => ({ ...r })) as ProductExtra[],
	track_stock: p?.track_stock ?? false,
	featured: p?.featured ?? false,
	custom_request: p?.custom_request ?? false,
	custom_request_label: p?.custom_request_label ?? "",
	active: p?.active ?? true,
	low_stock_at: String(p?.low_stock_at ?? 0),
	category_ids: p?.categories.map((c) => c.id) ?? [],
	kind: (p?.kind ?? "item") as "item" | "bundle",
	// a slot's allowed variants; null when the component product has none
	bundle_items: (p?.bundle_items ?? []).map((s) => ({
		product_id: s.product_id,
		variant_ids:
			s.options[0]?.variant_id === null
				? null
				: s.options.map((o) => o.variant_id!),
		qty: String(s.qty),
	})) as BundleRow[],
	variants: (p?.variants ?? []).map((v) => ({
		id: v.id,
		name: v.name,
		price: fromCents(v.price),
		purchase_price: v.purchase_price != null ? fromCents(v.purchase_price) : "",
		attributes: v.attributes,
		sku: v.sku ?? "",
		barcode: v.barcode ?? "",
		images: [...v.images],
	})) as {
		id?: number;
		name: string;
		price: string;
		purchase_price?: string;
		attributes?: Record<string, string> | null;
		sku?: string;
		barcode?: string;
		images: string[];
	}[],
});

// the `product.form` extension slot (the extension guide): an extension may read the form and fill fields it knows
const productSlot = {
	values: () => form.data() as Record<string, unknown>,
	set: (patch: Record<string, unknown>) => {
		const known = form.data() as Record<string, unknown>;
		for (const [k, v] of Object.entries(patch))
			if (k in known) (form as unknown as Record<string, unknown>)[k] = v;
	},
};

form.transform((data) => ({
	...data,
	price: toCents(data.price),
	purchase_price:
		data.purchase_price === "" ? null : toCents(data.purchase_price),
	original_price:
		data.original_price === "" ? null : toCents(data.original_price),
	sku: data.variants.length ? null : data.sku, // with variants, SKUs and barcodes live on the variants
	barcode: data.variants.length ? null : data.barcode,
	unit: data.unit.trim() || null,
	amount: data.amount === "" ? null : Number(data.amount),
	low_stock_at: Number(data.low_stock_at) || 0,
	bundle_items:
		data.kind === "bundle"
			? data.bundle_items.map((r: BundleRow) => ({
					...r,
					qty: Number(r.qty) || 0,
				}))
			: [],
	// a variant with an empty price uses the base price
	variants: data.variants.map((v) => ({
		...v,
		price: v.price === "" ? toCents(data.price) : toCents(v.price),
		purchase_price: v.purchase_price ? toCents(v.purchase_price) : null,
	})),
}));

// Three tabs: General (everything about the product itself), Variants — or Contents once it is a package — and
// Additional data (free title/value rows). Sections stay mounted (v-show) so the form state and file inputs survive switching.
type Tab = "general" | "items" | "extra";
const tab = ref<Tab>("general");
const addExtra = () => form.extra.push({ title: "", value: "" });
const itemsLabel = computed(() =>
	t(form.kind === "item" ? "products.tab_variants" : "products.tab_contents"),
);
const itemsCount = computed(() =>
	form.kind === "item" ? form.variants.length : form.bundle_items.length,
);
// a failed save lands on the tab that holds the first error
watch(
	() => form.errors,
	(e) => {
		const keys = Object.keys(e ?? {});
		if (!keys.length) return;
		tab.value = keys.some(
			(k) => k.startsWith("variants") || k.startsWith("bundle_items"),
		)
			? "items"
			: keys.some((k) => k.startsWith("extra"))
				? "extra"
				: "general";
	},
);

function submit() {
	if (!form.name.trim()) {
		form.setError("name", t("products.name_required"));
		return;
	}
	const done = {
		onSuccess: () =>
			toast.success(t(p ? "products.updated" : "products.created")),
		onError: (errors: Record<string, string>) =>
			toast.error(Object.values(errors)[0] ?? t("products.not_saved")),
	};
	if (p) form.put(`/products/${p.id}`, done);
	// A new product lands on its edit page, which is this same component.
	// Without a fresh mount `p` stays empty: the title still says "New product"
	// and a second save would create the product again.
	else form.post("/products", { ...done, preserveState: "errors" });
}
</script>

<template>
  <Head :title="p ? t('products.edit_name', { name: p.name }) : t('products.new_title')" />

  <form class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6" @submit.prevent="submit">
    <!-- Header -->
    <div class="flex flex-wrap items-center gap-3">
      <BackButton href="/products" :label="t('products.back_aria')" />
      <h1 class="mr-auto text-xl font-semibold tracking-tight">{{ p ? t("products.edit_heading") : t("products.new_title") }}</h1>
      <div class="ml-auto flex gap-2">
        <Button v-if="canShare" type="button" variant="outline" @click="sharing = true"><Share2 /> {{ t("products.share") }}</Button>
        <Button as-child variant="outline"><Link href="/products">{{ t("common.cancel") }}</Link></Button>
        <Button type="submit" :disabled="form.processing">{{ form.processing ? t("common.saving") : t("products.save") }}</Button>
      </div>
    </div>

    <Tabs :model-value="tab" @update:model-value="(v) => (tab = v as Tab)">
      <TabsList>
        <TabsTrigger value="general">{{ t("products.tab_general") }}</TabsTrigger>
        <TabsTrigger value="items">{{ itemsLabel }} <Badge v-if="itemsCount" variant="secondary" class="ml-1 h-5 min-w-5 px-1.5 tabular-nums">{{ itemsCount }}</Badge></TabsTrigger>
        <TabsTrigger value="extra">{{ t("products.tab_extra") }} <Badge v-if="form.extra.length" variant="secondary" class="ml-1 h-5 min-w-5 px-1.5 tabular-nums">{{ form.extra.length }}</Badge></TabsTrigger>
      </TabsList>
    </Tabs>

    <ExtensionSlot v-show="tab === 'general'" name="product.form" :context="productSlot" />

    <div v-show="tab === 'general'" class="grid gap-4 lg:grid-cols-3 lg:items-start">
      <!-- Main: details, then the custom request -->
      <div class="flex flex-col gap-4 lg:col-span-2">
        <!-- Details -->
        <Card>
          <CardHeader><CardTitle>{{ t("products.details") }}</CardTitle></CardHeader>
          <CardContent class="space-y-4">
            <div class="space-y-1.5">
              <Label for="name">{{ t("common.name") }}</Label>
              <Input id="name" v-model="form.name" :placeholder="t('products.name_placeholder')" :aria-invalid="!!form.errors.name" autofocus />
              <p v-if="form.errors.name" class="text-sm text-destructive">{{ form.errors.name }}</p>
            </div>

            <!-- With variants, SKU and barcode live on each variant row instead (the whole row goes, so no empty gap) -->
            <div v-if="!form.variants.length" class="grid gap-4 sm:grid-cols-2">
              <div class="space-y-1.5">
                <Label for="sku">{{ t("products.sku") }}</Label>
                <Input id="sku" v-model="form.sku" autocomplete="off" :placeholder="t('products.sku_placeholder')" :aria-invalid="!!form.errors.sku" @keydown.enter.prevent />
                <p v-if="form.errors.sku" class="text-sm text-destructive">{{ form.errors.sku }}</p>
                <p v-else class="text-xs text-muted-foreground">{{ t("products.sku_hint") }}</p>
              </div>

              <div class="space-y-1.5">
                <Label for="barcode">{{ t("products.barcode") }}</Label>
                <InputGroup>
                  <InputGroupAddon><ScanBarcode class="size-4" /></InputGroupAddon>
                  <InputGroupInput id="barcode" v-model="form.barcode" inputmode="numeric" autocomplete="off" :placeholder="t('products.scan_or_type')" :aria-invalid="!!form.errors.barcode" @keydown.enter.prevent />
                </InputGroup>
                <p v-if="form.errors.barcode" class="text-sm text-destructive">{{ form.errors.barcode }}</p>
                <p v-else class="text-xs text-muted-foreground">{{ t("products.barcode_hint") }}</p>
              </div>
            </div>

            <div class="space-y-1.5">
              <Label>{{ t("products.categories") }}</Label>
              <CategoryPicker v-model="form.category_ids" :categories="categories" />
            </div>

            <Label class="flex items-center justify-between gap-3 rounded-lg border p-3 font-normal">
              <span>
                <span class="block text-sm font-medium">{{ t("products.is_package") }}</span>
                <span class="block text-xs text-muted-foreground">{{ t("products.is_package_hint") }}</span>
              </span>
              <Switch :model-value="form.kind === 'bundle'" :aria-label="t('products.package')" @update:model-value="(v: boolean) => (form.kind = v ? 'bundle' : 'item')" />
            </Label>

            <div class="space-y-1.5">
              <Label>{{ t("products.description") }}</Label>
              <RichText v-model="form.description" images="products" :invalid="!!form.errors.description" />
              <p class="text-xs text-muted-foreground">{{ t("products.description_hint") }}</p>
              <p v-if="form.errors.description" class="text-sm text-destructive">{{ form.errors.description }}</p>
            </div>

          </CardContent>
        </Card>
        <!-- The online store asks the buyer for a note, like the name to engrave -->
        <div class="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <Label class="flex items-center justify-between gap-3 font-normal">
            <span>
              <span class="block text-sm font-medium">{{ t("products.custom_request") }}</span>
              <span class="block text-xs text-muted-foreground">{{ t("products.custom_request_hint") }}</span>
            </span>
            <Switch v-model="form.custom_request" :aria-label="t('products.custom_request')" />
          </Label>
          <div v-if="form.custom_request" class="space-y-1.5">
            <Label for="custom_request_label">{{ t("products.custom_request_label") }}</Label>
            <Input id="custom_request_label" v-model="form.custom_request_label" maxlength="100" :placeholder="t('products.custom_request_placeholder')" :aria-invalid="!!form.errors.custom_request_label" />
            <p v-if="form.errors.custom_request_label" class="text-sm text-destructive">{{ form.errors.custom_request_label }}</p>
          </div>
        </div>
      </div>

      <!-- Side: active, featured, images, pricing, inventory -->
      <div class="flex flex-col gap-4">
        <Label class="flex items-center justify-between gap-3 rounded-xl bg-card p-4 font-normal ring-1 ring-foreground/10">
          <span>
            <span class="block text-sm font-medium">{{ t("products.active") }}</span>
            <span class="block text-xs text-muted-foreground">{{ t("products.active_hint") }}</span>
          </span>
          <Switch v-model="form.active" :aria-label="t('products.active')" />
        </Label>
        <!-- Styled like the cards around it (Card's own ring/radius/background) -->
        <Label class="flex items-center justify-between gap-3 rounded-xl bg-card p-4 font-normal ring-1 ring-foreground/10">
          <span>
            <span class="block text-sm font-medium">{{ t("products.featured") }}</span>
            <span class="block text-xs text-muted-foreground">{{ t("products.featured_hint") }}</span>
          </span>
          <Switch v-model="form.featured" :aria-label="t('products.featured')" />
        </Label>
        <!-- extensions' own switches for this product (the Restaurant's "Send to kitchen"); id null = not saved yet -->
        <ExtensionSlot name="product.side" :context="{ id: p?.id ?? null }" />

        <Card>
          <CardHeader><CardTitle>{{ t("products.images") }}</CardTitle></CardHeader>
          <CardContent>
            <ImagesUpload v-model="form.images" />
            <p v-if="form.errors.images" class="mt-2 text-sm text-destructive">{{ form.errors.images }}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="flex items-center gap-2"><Tag class="size-4 text-muted-foreground" /> {{ t("products.pricing") }}</CardTitle>
          </CardHeader>
          <CardContent class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <Label for="price">{{ t("products.base_price") }}</Label>
              <InputGroup>
                <InputGroupAddon><InputGroupText>{{ currencySymbol }}</InputGroupText></InputGroupAddon>
                <InputGroupInput id="price" v-model="form.price" inputmode="decimal" placeholder="0.00" :aria-invalid="!!form.errors.price" />
              </InputGroup>
              <p v-if="form.errors.price" class="text-sm text-destructive">{{ form.errors.price }}</p>
              <p v-else class="text-xs text-muted-foreground">{{ t("products.base_price_hint") }}</p>
            </div>
            <div class="space-y-1.5">
              <Label for="original_price">{{ t("products.original_price") }}</Label>
              <InputGroup>
                <InputGroupAddon><InputGroupText>{{ currencySymbol }}</InputGroupText></InputGroupAddon>
                <InputGroupInput id="original_price" v-model="form.original_price" inputmode="decimal" placeholder="0.00" :aria-invalid="!!form.errors.original_price" />
              </InputGroup>
              <p v-if="form.errors.original_price" class="text-sm text-destructive">{{ form.errors.original_price }}</p>
              <p v-else class="text-xs text-muted-foreground">{{ t("products.original_price_hint") }}</p>
            </div>
            <div v-if="form.kind === 'item'" class="space-y-1.5">
              <Label for="purchase_price">{{ t("products.purchase_price") }}</Label>
              <InputGroup>
                <InputGroupAddon><InputGroupText>{{ currencySymbol }}</InputGroupText></InputGroupAddon>
                <InputGroupInput id="purchase_price" v-model="form.purchase_price" inputmode="decimal" placeholder="0.00" :aria-invalid="!!form.errors.purchase_price" />
              </InputGroup>
              <p v-if="form.errors.purchase_price" class="text-sm text-destructive">{{ form.errors.purchase_price }}</p>
              <p v-else class="text-xs text-muted-foreground">{{ t("products.purchase_price_hint") }}</p>
            </div>
            <div class="space-y-1.5">
              <Label for="unit">{{ t("products.unit") }}</Label>
              <UnitSelect id="unit" v-model="form.unit" :invalid="!!form.errors.unit" />
              <p v-if="form.errors.unit" class="text-sm text-destructive">{{ form.errors.unit }}</p>
              <p v-else class="text-xs text-muted-foreground">{{ t("products.unit_hint") }}</p>
            </div>
            <div class="space-y-1.5">
              <Label for="amount">{{ t("products.amount") }}</Label>
              <Input id="amount" v-model="form.amount" type="number" min="0" step="any" placeholder="50" :aria-invalid="!!form.errors.amount" />
              <p v-if="form.errors.amount" class="text-sm text-destructive">{{ form.errors.amount }}</p>
              <p v-else class="text-xs text-muted-foreground">{{ t("products.amount_hint") }}</p>
            </div>
          </CardContent>
        </Card>

        <!-- A package has no stock of its own — its availability is computed from what is inside it. -->
        <Card v-if="form.kind === 'item'">
          <CardHeader>
            <CardTitle class="flex items-center gap-2"><Boxes class="size-4 text-muted-foreground" /> {{ t("products.inventory") }}</CardTitle>
          </CardHeader>
          <CardContent class="space-y-4">
            <Label class="flex items-center justify-between gap-3 font-normal">
              <span>
                <span class="block text-sm font-medium">{{ t("products.track_stock") }}</span>
                <span class="block text-xs text-muted-foreground">{{ t("products.track_stock_hint") }}</span>
              </span>
              <Switch v-model="form.track_stock" />
            </Label>
            <template v-if="form.track_stock">
              <div class="space-y-1.5">
                <Label for="low_stock_at">{{ t("products.low_stock_at") }}</Label>
                <Input id="low_stock_at" v-model="form.low_stock_at" inputmode="numeric" class="w-32" :aria-invalid="!!form.errors.low_stock_at" />
                <p v-if="form.errors.low_stock_at" class="text-sm text-destructive">{{ form.errors.low_stock_at }}</p>
                <p v-else class="text-xs text-muted-foreground">{{ t("products.low_stock_hint") }}</p>
              </div>
            </template>
          </CardContent>
        </Card>


      </div>
    </div>

    <!-- Variants / Contents: one or the other, depending on the package switch -->
    <div v-show="tab === 'items'">
    <Card v-if="form.kind === 'item'">
      <CardHeader><CardTitle>{{ t("products.tab_variants") }}</CardTitle></CardHeader>
      <CardContent>
        <p v-if="form.errors.variants" class="mb-3 text-sm text-destructive">{{ form.errors.variants }}</p>
        <VariantsEditor
          v-model="form.variants"
          :base-price="form.price"
          :errors="form.errors as Record<string, string>"
          :currency-symbol="currencySymbol"
        />
      </CardContent>
    </Card>

    <Card v-else>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><PackageOpen class="size-4 text-muted-foreground" /> {{ t("products.tab_contents") }}</CardTitle>
      </CardHeader>
      <CardContent>
        <BundleItemsEditor
          v-model="form.bundle_items"
          :components="components"
          :errors="form.errors as Record<string, string>"
          :currency="currency"
          :price="form.price"
        />
      </CardContent>
    </Card>
    </div>

    <!-- Additional data: free title / value rows (Darreichungsform → Tabletten), shown before the description everywhere -->
    <Card v-show="tab === 'extra'">
      <CardHeader><CardTitle>{{ t("products.tab_extra") }}</CardTitle></CardHeader>
      <CardContent class="space-y-3">
        <p class="text-xs text-muted-foreground">{{ t("products.extra_hint") }}</p>
        <p v-if="form.errors.extra" class="text-sm text-destructive">{{ form.errors.extra }}</p>
        <div v-for="(r, i) in form.extra" :key="i" class="flex items-start gap-2">
          <div class="w-2/5 space-y-1">
            <Input v-model="r.title" :aria-label="t('products.extra_title')" :placeholder="t('products.extra_title_placeholder')" :aria-invalid="!!(form.errors as Record<string, string>)[`extra.${i}.title`]" @keydown.enter.prevent />
            <p v-if="(form.errors as Record<string, string>)[`extra.${i}.title`]" class="text-sm text-destructive">{{ (form.errors as Record<string, string>)[`extra.${i}.title`] }}</p>
          </div>
          <div class="flex-1 space-y-1">
            <Input v-model="r.value" :aria-label="t('products.extra_value')" :placeholder="t('products.extra_value')" :aria-invalid="!!(form.errors as Record<string, string>)[`extra.${i}.value`]" @keydown.enter.prevent />
            <p v-if="(form.errors as Record<string, string>)[`extra.${i}.value`]" class="text-sm text-destructive">{{ (form.errors as Record<string, string>)[`extra.${i}.value`] }}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" :aria-label="t('products.remove_row')" @click="form.extra.splice(i, 1)"><Trash2 class="size-4" /></Button>
        </div>
        <Button type="button" variant="outline" size="sm" @click="addExtra"><Plus class="size-4" /> {{ t("products.add_row") }}</Button>
      </CardContent>
    </Card>
  </form>
  <ShareDialog :product="sharing ? p : null" @close="sharing = false" />
</template>
