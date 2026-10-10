<script setup lang="ts">
import { computed } from "vue";
import { usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import { Copy, Share2 } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import { productUrl, shareTargets, tagged } from "@/lib/share";
import type { Product, SharedProps } from "@/types";

/**
 * Share one product's online store page: copy the link,
 * open a network's share page, or the phone's own share sheet.
 * Open while `product` is set; closing emits `close`.
 */
const props = defineProps<{ product: Pick<Product, "name" | "slug"> | null }>();
const emit = defineEmits<{ close: [] }>();

const page = usePage<SharedProps>();

/** The product page, or null while the online store is off. */
const url = computed(() => {
	const shop = page.props.shop;
	return shop && props.product
		? productUrl(shop, props.product.slug, page.props.store_url)
		: null;
});
const targets = computed(() =>
	url.value ? shareTargets(url.value, props.product?.name ?? "") : [],
);
/** Phones (and some browsers) have their own share sheet: Instagram, Messenger… */
const canShare = typeof navigator !== "undefined" && !!navigator.share;

/**
 * Copy the product link.
 */
function copy() {
	if (!url.value) return;
	navigator.clipboard.writeText(url.value).then(
		() => toast.success(t("products.share_copied")),
		() => toast.error(t("products.share_copy_failed")),
	);
}

/**
 * Open the device's own share sheet. Closing it without sharing is not an error.
 */
function shareNative() {
	if (!url.value || !props.product) return;
	navigator
		.share({ title: props.product.name, url: tagged(url.value, "share") })
		.catch(ignore);
}

/**
 * Do nothing: the buyer closed the share sheet.
 */
function ignore() {}

/**
 * Select the whole link when the box gets focus, ready to copy by hand.
 * @param e The focus event.
 */
function selectAll(e: FocusEvent) {
	(e.target as HTMLInputElement).select();
}

/**
 * Tell the parent the dialog was closed.
 * @param open The dialog's new state.
 */
function onOpen(open: boolean) {
	if (!open) emit("close");
}
</script>

<template>
  <Dialog :open="!!product && !!url" @update:open="onOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t("products.share_title", { name: product?.name ?? "" }) }}</DialogTitle>
        <DialogDescription>{{ t("products.share_desc") }}</DialogDescription>
      </DialogHeader>
      <div class="space-y-2">
        <Label for="share-link">{{ t("products.share_link") }}</Label>
        <InputGroup>
          <InputGroupInput id="share-link" :model-value="url ?? ''" readonly @focus="selectAll" />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="xs" @click="copy"><Copy /> {{ t("common.copy") }}</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <Button v-for="s in targets" :key="s.name" as-child variant="outline" size="sm">
          <a :href="s.url" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="s.icon" :fill="s.color" /></svg>
            {{ s.name }}
          </a>
        </Button>
      </div>
      <Button v-if="canShare" variant="secondary" @click="shareNative"><Share2 /> {{ t("products.share_more") }}</Button>
    </DialogContent>
  </Dialog>
</template>
