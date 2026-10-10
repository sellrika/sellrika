<script setup lang="ts">
import { ref } from "vue";
import { Button } from "@/components/ui/button";
import { ImagePlus, Loader2, Trash2 } from "@lucide/vue";
import { uploadImage } from "@/lib/upload";
import { t } from "@/lib/i18n";

const image = defineModel<string | null>({ required: true });

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const dragging = ref(false);
const error = ref("");

async function upload(file: File | null | undefined) {
	if (!file || uploading.value) return;
	uploading.value = true;
	error.value = "";
	const r = await uploadImage(file, "extensions");
	if ("error" in r) error.value = r.error;
	else image.value = r.url;
	uploading.value = false;
	if (fileInput.value) fileInput.value.value = "";
}

const onDrop = (e: DragEvent) => {
	dragging.value = false;
	upload(e.dataTransfer?.files?.[0]);
};
const onPick = (e: Event) => upload((e.target as HTMLInputElement).files?.[0]);
</script>

<template>
  <div class="space-y-2">
    <input
      ref="fileInput"
      type="file"
      accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
      class="sr-only"
      @change="onPick"
    />

    <div v-if="image" class="overflow-hidden rounded-lg border">
      <img :src="image" :alt="t('products.product_image')" class="aspect-square w-full bg-muted object-cover" />
      <div class="flex gap-2 border-t bg-background p-2">
        <Button type="button" variant="outline" size="sm" class="flex-1" :disabled="uploading" @click="fileInput?.click()">
          <Loader2 v-if="uploading" class="animate-spin" />
          {{ uploading ? t("products.uploading") : t("products.replace") }}
        </Button>
        <Button type="button" variant="destructive" size="sm" @click="image = null">
          <Trash2 /> {{ t("common.remove") }}
        </Button>
      </div>
    </div>

    <button
      v-else
      type="button"
      class="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input px-4 text-center text-sm text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      :class="dragging && 'border-primary bg-muted/60'"
      @click="fileInput?.click()"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <Loader2 v-if="uploading" class="size-6 animate-spin" />
      <ImagePlus v-else class="size-6" />
      <span class="font-medium text-foreground">{{ uploading ? t("products.uploading") : t("products.click_or_drop") }}</span>
      <span class="text-xs">{{ t("products.image_formats") }}</span>
    </button>

    <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
  </div>
</template>
