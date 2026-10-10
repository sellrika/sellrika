<script setup lang="ts">
import { computed, ref } from "vue";
import { ImagePlus, Link, Loader2, Pencil, Star, X } from "@lucide/vue";
import { uploadImage, type UploadFolder } from "@/lib/upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/lib/i18n";
import ImageEditor from "./ImageEditor.vue";

// Multiple images; the first one is the cover. `compact` = small tiles (variant rows).
// Every image is one of our uploads (`/uploads/…`): a pasted https link is cropped and uploaded like a picked file.
// `folder` = where the uploads go, `products` when left out.
const props = defineProps<{
	compact?: boolean;
	max?: number;
	folder?: UploadFolder;
}>();
const images = defineModel<string[]>({ required: true });

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(0);
const dragging = ref(false);
const error = ref("");
const linking = ref(false); // the "paste a link" box is open
const link = ref("");
const limit = () => props.max ?? 10;
// picked files and pasted links wait here; the editor crops them to a square one at a time
const queue = ref<(File | string)[]>([]);
// the index of an image the list already has, open in the editor
const editing = ref<number | null>(null);
const editorSource = computed(function editorSource() {
	return editing.value === null
		? (queue.value[0] ?? null)
		: (images.value[editing.value] ?? null);
});

/**
 * Queue the picked files for the editor, up to the image limit.
 * @param files the files that were picked or dropped
 */
function upload(files: FileList | File[] | null | undefined) {
	const room =
		limit() - images.value.length - queue.value.length - uploading.value;
	queue.value.push(...Array.from(files ?? []).slice(0, Math.max(0, room)));
	error.value = "";
	if (fileInput.value) fileInput.value.value = "";
}

/**
 * Upload the edited square: a picked file is added to the list,
 * an edited image takes the old one's place.
 * @param file the cropped image from the editor
 */
async function onSave(file: File) {
	const at = editing.value;
	const old = at === null ? null : images.value[at];
	if (at === null) queue.value.shift();
	editing.value = null;
	uploading.value++;
	const r = await uploadImage(file, props.folder ?? "products");
	uploading.value--;
	if ("error" in r) return void (error.value = r.error);
	const now = old === null ? -1 : images.value.indexOf(old as string);
	if (now >= 0) images.value[now] = r.url;
	else images.value.push(r.url);
}

/** Close the editor without saving: a picked file is dropped, an existing image stays as it was. */
function onDiscard() {
	if (editing.value === null) queue.value.shift();
	editing.value = null;
}
const onDrop = (e: DragEvent) => {
	dragging.value = false;
	upload(e.dataTransfer?.files);
};
const onPick = (e: Event) => upload((e.target as HTMLInputElement).files);
const makeCover = (i: number) =>
	images.value.unshift(...images.value.splice(i, 1));

/** Open the typed https link in the editor; saving it uploads a copy to our storage. */
function addLink() {
	const url = link.value.trim();
	if (!/^https:\/\/\S+$/.test(url))
		return void (error.value = t("products.link_error"));
	error.value = "";
	if (images.value.length + queue.value.length + uploading.value < limit())
		queue.value.push(url);
	link.value = "";
	linking.value = false;
}
</script>

<template>
  <div :class="compact ? 'space-y-1' : 'space-y-2'">
    <ImageEditor :source="editorSource" @save="onSave" @discard="onDiscard" />
    <input ref="fileInput" type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif,image/gif" class="sr-only" @change="onPick" />

    <!-- compact: one scrollable strip, badges hang outside the thumbnail (hence the padding) -->
    <div class="flex items-center" :class="compact ? 'gap-2.5 overflow-x-auto px-1 pt-1.5 pb-0.5' : 'flex-wrap gap-2'">
      <div
        v-for="(img, i) in images"
        :key="img"
        class="group relative shrink-0"
        :class="compact ? 'size-9' : 'size-24'"
      >
        <button
          type="button"
          class="relative block size-full rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          :title="t('products.edit_image_n', { n: i + 1 })"
          :aria-label="t('products.edit_image_n', { n: i + 1 })"
          @click="editing = i"
        >
          <img :src="img" :alt="i === 0 ? t('products.cover_image') : t('products.image_n', { n: i + 1 })" class="size-full cursor-pointer rounded-lg border bg-muted object-cover" />
          <!-- hover / keyboard focus: a dark layer with a pencil says "click to edit" -->
          <span class="absolute inset-0 hidden items-center justify-center gap-1 rounded-lg bg-black/45 text-xs font-medium text-white group-hover:flex group-has-[:focus-visible]:flex" aria-hidden="true">
            <Pencil :class="compact ? 'size-3.5' : 'size-4'" />
            <span v-if="!compact">{{ t("common.edit") }}</span>
          </span>
        </button>
        <span v-if="i === 0 && !compact" class="absolute bottom-1 left-1 rounded bg-background/90 px-1 text-[10px] font-medium">{{ t("products.cover") }}</span>
        <button
          v-if="i > 0 && !compact"
          type="button"
          class="absolute bottom-1 right-1 hidden rounded bg-background/90 p-0.5 text-muted-foreground hover:text-foreground group-hover:block group-has-[:focus-visible]:block"
          :title="t('products.make_cover')"
          :aria-label="t('products.make_cover')"
          @click="makeCover(i)"
        >
          <Star class="size-3" />
        </button>
        <button
          type="button"
          class="absolute flex items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-destructive"
          :class="compact ? '-top-1.5 -right-1.5 size-4' : 'top-1 right-1 hidden size-5 group-hover:flex group-has-[:focus-visible]:flex'"
          :aria-label="t('products.remove_image')"
          @click="images.splice(i, 1)"
        >
          <X class="size-3" />
        </button>
      </div>

      <button
        v-if="images.length < limit()"
        type="button"
        class="flex shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-input text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        :class="[compact ? 'h-9 px-2.5 text-xs' : 'size-24 border-2 text-xs', dragging && 'border-primary bg-muted/60']"
        :disabled="uploading > 0"
        @click="fileInput?.click()"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <span class="flex items-center gap-1.5">
          <Loader2 v-if="uploading" class="size-4 animate-spin" />
          <ImagePlus v-else class="size-4" />
          <span v-if="compact && !images.length">{{ uploading ? t("products.uploading") : t("products.add_images") }}</span>
        </span>
        <span v-if="!compact">{{ uploading ? t("products.uploading") : t("common.add") }}</span>
      </button>

      <button
        v-if="images.length < limit()"
        type="button"
        class="flex shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-input text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        :class="compact ? 'h-9 px-2.5 text-xs' : 'size-24 border-2 text-xs'"
        :aria-label="t('products.add_image_link')"
        :aria-expanded="linking"
        @click="linking = !linking"
      >
        <Link class="size-4" />
        <span v-if="!compact">{{ t("products.link") }}</span>
      </button>
    </div>

    <div v-if="linking" class="flex items-center gap-2">
      <Input v-model="link" type="url" placeholder="https://…/photo.jpg" :aria-label="t('products.image_link')" class="h-8 text-sm" autofocus @keydown.enter.prevent="addLink" />
      <Button type="button" size="sm" @click="addLink">{{ t("products.add_link") }}</Button>
    </div>

    <p v-if="!compact && !error" class="text-xs text-muted-foreground">{{ t("products.images_hint") }}</p>
    <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
  </div>
</template>
