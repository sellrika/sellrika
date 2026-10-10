<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Head, useForm } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import { Loader2 } from "@lucide/vue";
import grapesjs, { type Editor } from "grapesjs";
import "grapesjs/dist/css/grapes.min.css";
import AppLayout from "@/layouts/AppLayout.vue";
import BackButton from "@/components/BackButton.vue";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { uploadImage } from "@/lib/upload";
import { t } from "@/lib/i18n";
import type { StorePage } from "@/types";

defineOptions({ layout: AppLayout });
const props = defineProps<{ page: StorePage | null }>();

const form = useForm({
	title: props.page?.title ?? "",
	slug: props.page?.slug ?? "",
	body: "",
	css: "",
});

// new page: the slug follows the title until it's edited by hand
const slugEdited = ref(!!props.page);
const slugify = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
watch(
	() => form.title,
	(title) => {
		if (!slugEdited.value) form.slug = slugify(title);
	},
);

const canvas = ref<HTMLElement | null>(null);
let editor: Editor | null = null;

/** What a brand-new page starts with. */
function starter() {
	return `<section style="padding:24px 0"><h1>${t("online_store.starter_title")}</h1><p>${t("online_store.starter_text")}</p></section>`;
}
/** The blocks panel — built when the editor mounts, so the labels are in the page's language. */
function blockList() {
	const layout = t("online_store.block_layout");
	const basic = t("online_store.block_basic");
	return [
		{
			id: "section",
			label: t("online_store.block_section"),
			category: layout,
			content: `<section style="padding:24px 0"><h2>${t("online_store.block_section_title")}</h2><p>${t("online_store.block_section_text")}</p></section>`,
		},
		{
			id: "columns",
			label: t("online_store.block_columns"),
			category: layout,
			content: `<div style="display:flex;gap:16px;flex-wrap:wrap"><div style="flex:1;min-width:200px"><p>${t("online_store.block_left_column")}</p></div><div style="flex:1;min-width:200px"><p>${t("online_store.block_right_column")}</p></div></div>`,
		},
		{
			id: "heading",
			label: t("online_store.block_heading"),
			category: basic,
			content: `<h2>${t("online_store.block_heading_text")}</h2>`,
		},
		{
			id: "text",
			label: t("online_store.block_text"),
			category: basic,
			content: `<p>${t("online_store.block_text_content")}</p>`,
		},
		{
			id: "image",
			label: t("online_store.block_image"),
			category: basic,
			content: { type: "image" },
		},
		{
			id: "button",
			label: t("online_store.block_button"),
			category: basic,
			content: `<a href="#" style="display:inline-block;padding:10px 20px;background:#18181b;color:#fff;border-radius:8px;text-decoration:none">${t("online_store.block_button_text")}</a>`,
		},
		{
			id: "quote",
			label: t("online_store.block_quote"),
			category: basic,
			content: `<blockquote style="border-left:3px solid #d4d4d8;margin:0;padding-left:16px;color:#52525b">${t("online_store.block_quote_text")}</blockquote>`,
		},
		{
			id: "divider",
			label: t("online_store.block_divider"),
			category: basic,
			content: "<hr>",
		},
	];
}

onMounted(() => {
	editor = grapesjs.init({
		container: canvas.value!,
		height: "100%",
		fromElement: false,
		storageManager: false, // saving goes through the form below, not GrapesJS storage
		canvasCss:
			"body { padding: 5px; font-family: 'Geist Sans', ui-sans-serif, system-ui, sans-serif }", // editor-only, not part of the saved page css — the preview reads like the storefront, not Times
		components: props.page?.body || starter(),
		style: props.page?.css || "",
		blockManager: { blocks: blockList() },
		assetManager: {
			// images go through the app's normal /uploads endpoint
			async uploadFile(ev: DragEvent) {
				// a drop carries dataTransfer; the file picker's change event only has target.files
				const files =
					ev.dataTransfer?.files ??
					(ev.target as HTMLInputElement | null)?.files ??
					[];
				for (const file of Array.from(files)) {
					const r = await uploadImage(file, "pages");
					if ("error" in r) toast.error(r.error);
					else editor!.AssetManager.add({ src: r.url });
				}
			},
		},
	});
	// the canvas is its own document, so it can't see the app's bundled Geist @font-face rules — hand it copies (the
	// browser has already resolved their font URLs), so the preview reads in the same font the storefront uses
	editor.on("load", () => {
		const faces = Array.from(document.styleSheets)
			.flatMap((sheet) => {
				try {
					return Array.from(sheet.cssRules);
				} catch {
					return [];
				}
			}) // a cross-origin sheet throws
			.filter(
				(r): r is CSSFontFaceRule =>
					r instanceof CSSFontFaceRule && r.style.fontFamily.includes("Geist"),
			);
		const doc = editor!.Canvas.getDocument();
		if (!doc) return; // the canvas iframe isn't there yet
		const style = doc.createElement("style");
		style.textContent = faces.map((r) => r.cssText).join("\n");
		doc.head.append(style);
	});
});
onBeforeUnmount(() => editor?.destroy());

function save() {
	form.body = editor?.getHtml() ?? "";
	form.css = editor?.getCss() ?? "";
	const opts = {
		onSuccess: () => toast.success(t("online_store.page_saved")),
		// the slim header has no room for inline error text
		onError: (errors: Record<string, string>) =>
			toast.error(Object.values(errors)[0] ?? t("online_store.page_not_saved")),
	};
	props.page
		? form.put(`/online-store/pages/${props.page.id}`, opts)
		: form.post("/online-store/pages", opts);
}
</script>

<template>
  <Head :title="page ? t('online_store.edit_page_name', { title: page.title }) : t('online_store.new_page_title')" />
  <div class="flex h-full flex-col">
    <header class="flex h-14 shrink-0 items-center gap-2 border-b px-3">
      <BackButton href="/online-store" :label="t('online_store.back_aria')" />
      <input
        v-model="form.title"
        :placeholder="t('online_store.page_title_placeholder')"
        :aria-label="t('online_store.page_title_aria')"
        :aria-invalid="!!form.errors.title"
        class="h-9 w-full max-w-56 rounded-md bg-muted/60 px-2 text-sm font-medium outline-none placeholder:text-muted-foreground focus-visible:bg-muted/60 aria-invalid:ring-1 aria-invalid:ring-destructive"
      />
      <div
        class="hidden h-9 items-center overflow-hidden rounded-md border bg-muted/40 text-sm sm:flex"
        :class="form.errors.slug && 'border-destructive'"
      >
        <span class="shrink-0 border-r bg-muted px-2.5 leading-9 text-muted-foreground">/pages/</span>
        <input
          v-model="form.slug"
          placeholder="about-us"
          :aria-label="t('online_store.page_address_aria')"
          class="h-full w-40 bg-transparent px-2.5 outline-none placeholder:text-muted-foreground"
          @input="slugEdited = true"
        />
      </div>
      <div class="ml-auto flex items-center gap-3">
        <Button :disabled="form.processing" @click="save">
          <Loader2 v-if="form.processing" class="animate-spin" /> {{ t("online_store.save_page") }}
        </Button>
      </div>
    </header>
    <div class="min-h-0 flex-1">
      <div ref="canvas" class="h-full" />
    </div>
  </div>
</template>

<!-- GrapesJS paints its panels from these variables (grapes.min.css); pointing them at the app tokens makes the
     editor chrome follow light / dark like the rest of the admin. Not scoped: the panels render inside the container
     but outside this component's scoped selectors. The canvas iframe stays as-is — it is the buyer's page. -->
<style>
.gjs-editor {
  --gjs-primary-color: var(--sidebar); /* panels — the sidebar tone, so they stand off the white canvas in light mode too */
  --gjs-secondary-color: var(--foreground); /* text + icons */
  --gjs-tertiary-color: var(--primary); /* active tab, selection outline */
  --gjs-quaternary-color: var(--primary); /* the pink highlight → the app accent */
  --gjs-main-dark-color: var(--muted);
  --gjs-main-light-color: var(--border);
  --gjs-font-color: var(--foreground);
  --gjs-font-size: 0.875rem;
  --gjs-arrow-color: var(--foreground); /* select chevrons, faint on light panels otherwise */
  font-family: var(--font-sans);
}
/* the canvas starts at --gjs-canvas-top, but the device panel (padding + select) grew past it and the white canvas
   peeked out beside it — pin the three top panels to exactly that height */
.gjs-pn-views-container { border-left: 1px solid var(--border); }
.gjs-pn-devices-c,
.gjs-pn-commands,
.gjs-pn-options {
  height: var(--gjs-canvas-top);
  display: flex;
  align-items: center;
  padding: 0 5px;
}
/* toolbar buttons: the active one reads like the app's primary button (yellow on dark / dark on yellow), not a grey square */
.gjs-pn-btn { border-radius: 6px; }
.gjs-pn-btn.gjs-pn-active { background: var(--primary); color: var(--primary-foreground); box-shadow: none; }
.gjs-pn-btn:hover:not(.gjs-pn-active) { color: var(--foreground); background: var(--muted); }
/* Blocks panel: compact label tiles instead of GrapesJS's tall empty squares */
.gjs-blocks-c { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px; }
.gjs-block {
  width: calc(50% - 4px); min-height: 0; margin: 0; padding: 12px 8px; justify-content: center;
  border: 1px solid var(--border); border-radius: var(--radius); box-shadow: none; font-size: 0.8125rem; font-weight: 500;
}
.gjs-block:hover { color: var(--foreground); background: var(--muted); border-color: var(--primary); }
.gjs-block-label { line-height: 1.25; }
.gjs-block-category .gjs-title { letter-spacing: 0; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; padding: 10px; }
.gjs-block-category .gjs-caret-icon { margin-right: 6px; }
</style>
