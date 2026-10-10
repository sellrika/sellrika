<script setup lang="ts">
// A payment method's picture for the customer's screen (a QR code to pay): upload, replace or remove.
// From the Pencil design "Payments · Edit dialog".
import { ref } from "vue";
import { toast } from "vue-sonner";
import { Loader2, QrCode, Trash2, Upload } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { uploadImage } from "@/lib/upload";

/** The picture's `/uploads/…` path, null = none. */
const model = defineModel<string | null>({ required: true });

const input = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
/**
 * Upload the picked file and keep its path.
 * @param e The file input's change event.
 */
async function pick(e: Event) {
	const el = e.target as HTMLInputElement;
	const file = el.files?.[0];
	if (!file || uploading.value) return;
	uploading.value = true;
	const r = await uploadImage(file, "payments");
	if ("error" in r) toast.error(r.error);
	else model.value = r.url;
	uploading.value = false;
	el.value = "";
}
</script>

<template>
  <div class="flex items-start gap-4 rounded-lg border p-4">
    <input ref="input" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" class="sr-only" :aria-label="t('payment_methods.image_file')" @change="pick" />
    <div class="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground" :class="!model && 'border-2 border-dashed border-input'">
      <Loader2 v-if="uploading" class="size-6 animate-spin" />
      <img v-else-if="model" :src="model" :alt="t('payment_methods.image')" class="size-full object-contain" data-image-preview />
      <QrCode v-else class="size-10" />
    </div>
    <div class="grid min-w-0 flex-1 gap-3">
      <p class="text-sm text-muted-foreground">{{ t("payment_methods.image_hint") }}</p>
      <div class="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" :disabled="uploading" @click="input?.click()">
          <Upload /> {{ t(model ? "payment_methods.image_replace" : "payment_methods.image_upload") }}
        </Button>
        <Button v-if="model" type="button" variant="ghost" size="sm" class="text-destructive hover:text-destructive" @click="model = null">
          <Trash2 /> {{ t("common.remove") }}
        </Button>
      </div>
    </div>
  </div>
</template>
