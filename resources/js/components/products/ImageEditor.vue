<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
	FlipHorizontal2,
	FlipVertical2,
	Loader2,
	Eraser,
	Sparkles,
	Redo2,
	RotateCcwSquare,
	RotateCwSquare,
	Focus,
	Plus,
	Undo2,
} from "@lucide/vue";
import { toast } from "vue-sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/lib/i18n";
import { imageBlob } from "@/lib/upload";
import {
	preloadBackgroundModel,
	type RemovalStep,
	removeBackground,
} from "@/lib/removeBackground";

/**
 * Crop, flip and rotate one photo: a picked file before it is uploaded,
 * or an image the product already has (an upload or an https link).
 * The crop is always a 1:1 square: the POS grid, the product page and
 * every store template show product photos as squares, so one shape fits all.
 * The owner moves (drag) and zooms (slider, mouse wheel) the photo under the square frame.
 */
const props = defineProps<{ source: File | string | null }>();
const emit = defineEmits<{ save: [file: File]; discard: [] }>();

/** Width and height of the saved square, in pixels. */
const SIZE = 1200;
/** Width and height of the preview canvas, in pixels. */
const VIEW = 600;
/** How far past "fills the square" the owner may zoom in. */
const MAX_ZOOM = 4;
/** How fast the mouse wheel zooms: one wheel notch (100) is about 20%. */
const WHEEL_ZOOM = 0.002;
/** Most padding on each side, as a part of the square's width. */
const MAX_PAD = 0.2;
/** How small a cut-out product may get, as a part of "just fits the square". */
const CUTOUT_MIN = 0.2;
/** A fresh cut-out's size: some room around the product, so it can be moved right away. */
const CUTOUT_START = 0.8;
/** Pixels at least this opaque (0–255) count as the product when the cut-out is trimmed. */
const TRIM_ALPHA = 8;
/**
 * The shadow under a cut-out, at full strength, as parts of the square's width.
 * `blur` / `drop` = the soft shadow in the product's own shape and how far down it falls.
 * `ground` = how dark the oval under the product is (0–1), `flat` = its height as a part of its width.
 */
const SHADOW = { blur: 0.04, drop: 0.015, dark: 0.35, ground: 0.5, flat: 0.12 };
/** Ready-made backgrounds; "" = transparent (kept by png / webp photos). */
const BACKGROUNDS = [
	{ label: "products.bg_none", color: "" },
	{ label: "products.bg_white", color: "#ffffff" },
	{ label: "products.bg_light_gray", color: "#f4f4f5" },
	{ label: "products.bg_cream", color: "#f5efe6" },
	{ label: "products.bg_black", color: "#171717" },
] as const;

/**
 * One state of the edit.
 * `zoom` 1 = the photo just fills the square, below 1 = it fits inside it.
 * `x` / `y` = how far the photo is moved from the centre, as a part of the photo area's width.
 * `pad` = empty space on each side, as a part of the square's width; the photo area is what is left.
 * `bg` = the colour behind the photo and in the padding, "" = transparent.
 * `cutout` = show the photo with its background removed.
 * `shadow` = how strong the shadow under a cut-out is, 0 = none, 1 = full.
 */
type Edit = {
	rotate: number;
	flipX: boolean;
	flipY: boolean;
	zoom: number;
	x: number;
	y: number;
	pad: number;
	bg: string;
	cutout: boolean;
	shadow: number;
};
const START: Edit = {
	rotate: 0,
	flipX: false,
	flipY: false,
	zoom: 1,
	x: 0,
	y: 0,
	pad: 0,
	bg: "#ffffff",
	cutout: false,
	shadow: 0,
};

const canvas = ref<HTMLCanvasElement | null>(null);
const edit = ref<Edit>({ ...START });
/** The photo as loaded. */
const photo = ref<HTMLImageElement | null>(null);
/** The product cut out of the photo, trimmed to its own edges; null = not made yet. */
const cut = ref<HTMLImageElement | null>(null);

/**
 * The image an edit shows: the cut-out after "Remove background", else the photo.
 * @param e the edit state
 * @returns the image, or null while the photo loads
 */
function imageOf(e: Edit) {
	return e.cutout && cut.value ? cut.value : photo.value;
}

/** The image the canvas shows now. */
const image = computed(function image() {
	return imageOf(edit.value);
});
const history = ref<Edit[]>([{ ...START }]);
const step = ref(0);
const saving = ref(false);
/** The background removal in progress; null = not running. */
const removing = ref<RemovalStep | null>(null);
/** The photo as it was before the cut-out, while it is wiped away; null = no wipe running. */
const reveal = ref<string | null>(null);

/** The wipe finished: drop the old picture. */
function endReveal() {
	reveal.value = null;
}
const error = ref("");
let drag: { px: number; py: number; x: number; y: number } | null = null;
/** Records a wheel zoom once the scrolling stops, so one scroll is one undo step. */
let wheelDone: ReturnType<typeof setTimeout> | undefined;

/** The zoom where the whole photo fits inside the square. */
/**
 * The zoom where the whole image of an edit fits inside the square.
 * @param e the edit state
 * @returns 1 for a square image, less for a long one
 */
function fitZoom(e: Edit) {
	const img = imageOf(e);
	if (!img) return 1;
	const w = img.naturalWidth;
	const h = img.naturalHeight;
	return Math.min(w, h) / Math.max(w, h);
}

/**
 * The smallest zoom of an edit.
 * A photo never gets smaller than "fits the square" (its edges would show);
 * a cut-out product may, so it can be made smaller and moved anywhere in the square.
 * @param e the edit state
 * @returns the lowest zoom the slider allows
 */
function minZoomOf(e: Edit) {
	return e.cutout ? fitZoom(e) * CUTOUT_MIN : fitZoom(e);
}

/** The zoom slider's lowest value. */
const minZoom = computed(function minZoom() {
	return minZoomOf(edit.value);
});

/**
 * The photo's size on the square after rotation and zoom.
 * @param e the edit state
 * @returns width and height as a part of the square's width
 */
function shown(e: Edit) {
	const img = imageOf(e) as HTMLImageElement;
	const turned = e.rotate % 180 !== 0;
	const w = turned ? img.naturalHeight : img.naturalWidth;
	const h = turned ? img.naturalWidth : img.naturalHeight;
	const scale = e.zoom / Math.min(w, h);
	return { w: w * scale, h: h * scale };
}

/**
 * Keep the zoom in range and the photo over the square: a bigger photo
 * always covers the square, a smaller one always stays inside it.
 * @param e the edit state to check
 * @returns the same state, moved back into range
 */
function clamp(e: Edit): Edit {
	const zoom = Math.min(MAX_ZOOM, Math.max(minZoomOf(e), e.zoom));
	const { w, h } = shown({ ...e, zoom });
	const bx = Math.abs(w - 1) / 2;
	const by = Math.abs(h - 1) / 2;
	return {
		...e,
		zoom,
		x: Math.min(bx, Math.max(-bx, e.x)),
		y: Math.min(by, Math.max(-by, e.y)),
	};
}

/**
 * Paint the shadow under a cut-out: a soft dark oval where the product stands,
 * then a soft shadow in the product's own shape for the drawImage that follows.
 * The canvas draws shadows in pixels, never turned or flipped with the photo, so they always fall down.
 * @param ctx the canvas, clipped to the photo area; the caller restores it after the drawImage
 * @param strength how strong the shadow is, 0–1
 * @param size the square's width in pixels
 * @param box the product's centre, bottom and width in pixels
 */
function shade(
	ctx: CanvasRenderingContext2D,
	strength: number,
	size: number,
	box: { x: number; bottom: number; width: number },
) {
	const r = box.width / 2;
	ctx.save();
	ctx.translate(box.x, box.bottom);
	ctx.scale(1, SHADOW.flat);
	const ground = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
	ground.addColorStop(0, `rgba(0,0,0,${SHADOW.ground * strength})`);
	ground.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = ground;
	ctx.fillRect(-r, -r, 2 * r, 2 * r);
	ctx.restore();
	ctx.shadowColor = `rgba(0,0,0,${SHADOW.dark * strength})`;
	ctx.shadowBlur = size * SHADOW.blur;
	ctx.shadowOffsetY = size * SHADOW.drop;
}

/**
 * Paint the background, then the photo inside the padding.
 * @param target the canvas to paint on
 * @param size its width and height in pixels
 */
function paint(target: HTMLCanvasElement, size: number) {
	const img = image.value;
	const ctx = target.getContext("2d");
	if (!img || !ctx) return;
	const e = edit.value;
	const edge = size * e.pad;
	const area = size - 2 * edge;
	const scale = (area * e.zoom) / Math.min(img.naturalWidth, img.naturalHeight);
	ctx.clearRect(0, 0, size, size);
	if (e.bg) {
		ctx.fillStyle = e.bg;
		ctx.fillRect(0, 0, size, size);
	}
	ctx.save();
	// the photo never spills into the padding
	ctx.beginPath();
	ctx.rect(edge, edge, area, area);
	ctx.clip();
	const x = size / 2 + e.x * area;
	const y = size / 2 + e.y * area;
	if (e.cutout && e.shadow) {
		const { w, h } = shown(e);
		shade(ctx, e.shadow, size, {
			x,
			bottom: y + (h * area) / 2,
			width: w * area,
		});
	}
	ctx.translate(x, y);
	ctx.scale(e.flipX ? -1 : 1, e.flipY ? -1 : 1);
	ctx.rotate((e.rotate * Math.PI) / 180);
	ctx.drawImage(
		img,
		(-img.naturalWidth * scale) / 2,
		(-img.naturalHeight * scale) / 2,
		img.naturalWidth * scale,
		img.naturalHeight * scale,
	);
	ctx.restore();
}

/** Redraw the preview. */
function draw() {
	if (canvas.value) paint(canvas.value, VIEW);
}

/** Add the current state to the undo history, dropping any redo steps. */
function commit() {
	const last = history.value[step.value];
	if (JSON.stringify(last) === JSON.stringify(edit.value)) return;
	history.value = [
		...history.value.slice(0, step.value + 1),
		{ ...edit.value },
	];
	step.value = history.value.length - 1;
}

/**
 * Change the edit and record it as one undo step.
 * @param change the fields to change
 */
function apply(change: Partial<Edit>) {
	edit.value = clamp({ ...edit.value, ...change });
	commit();
}

/**
 * Go to another step of the history.
 * @param by -1 = undo, 1 = redo
 */
function go(by: number) {
	const next = step.value + by;
	if (next < 0 || next >= history.value.length) return;
	step.value = next;
	edit.value = { ...history.value[next] };
}

/** Mirror the photo left to right. */
function flipHorizontal() {
	apply({ flipX: !edit.value.flipX, x: -edit.value.x });
}

/** Mirror the photo top to bottom. */
function flipVertical() {
	apply({ flipY: !edit.value.flipY, y: -edit.value.y });
}

/**
 * Turn the photo a quarter turn.
 * A mirrored photo turns the other way inside the canvas, so the owner still sees the turn they asked for.
 * @param dir 1 = clockwise, -1 = counter-clockwise
 */
function turn(dir: number) {
	const e = edit.value;
	const mirrored = e.flipX !== e.flipY;
	const delta = mirrored ? -dir * 90 : dir * 90;
	apply({
		rotate: (e.rotate + delta + 360) % 360,
		x: dir > 0 ? -e.y : e.y,
		y: dir > 0 ? e.x : -e.x,
	});
}

/**
 * Zoom while the slider moves; the step is recorded when it is let go.
 * @param event the slider's input event
 */
function onZoom(event: Event) {
	const zoom = Number((event.target as HTMLInputElement).value);
	edit.value = clamp({ ...edit.value, zoom });
}

/**
 * Zoom with the mouse wheel or a trackpad pinch; the step is recorded when the scrolling stops.
 * @param event the wheel event on the canvas
 */
function onWheel(event: WheelEvent) {
	if (!image.value) return;
	const zoom = edit.value.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM);
	edit.value = clamp({ ...edit.value, zoom });
	clearTimeout(wheelDone);
	wheelDone = setTimeout(commit, 300);
}

/**
 * Change the padding while the slider moves; the step is recorded when it is let go.
 * @param event the slider's input event
 */
function onPad(event: Event) {
	const pad = Number((event.target as HTMLInputElement).value);
	edit.value = { ...edit.value, pad };
}

/**
 * Change the shadow while the slider moves; the step is recorded when it is let go.
 * @param event the slider's input event
 */
function onShadow(event: Event) {
	const shadow = Number((event.target as HTMLInputElement).value);
	edit.value = { ...edit.value, shadow };
}

/** The background is a colour picked by hand, not one of the ready-made ones. */
const customBg = computed(function customBg() {
	return !!edit.value.bg && !BACKGROUNDS.some((b) => b.color === edit.value.bg);
});

/**
 * Change the background while the colour picker moves; the step is recorded when it closes.
 * @param event the colour input's input event
 */
function onColor(event: Event) {
	edit.value = { ...edit.value, bg: (event.target as HTMLInputElement).value };
}

/**
 * Start moving the photo.
 * @param event the pointer that went down on the canvas
 */
function onDown(event: PointerEvent) {
	(event.target as HTMLElement).setPointerCapture(event.pointerId);
	drag = {
		px: event.clientX,
		py: event.clientY,
		x: edit.value.x,
		y: edit.value.y,
	};
}

/**
 * Move the photo with the pointer.
 * @param event the moving pointer
 */
function onMove(event: PointerEvent) {
	if (!drag || !canvas.value) return;
	const width = canvas.value.clientWidth * (1 - 2 * edit.value.pad);
	edit.value = clamp({
		...edit.value,
		x: drag.x + (event.clientX - drag.px) / width,
		y: drag.y + (event.clientY - drag.py) / width,
	});
}

/** Stop moving the photo and record the move. */
function onUp() {
	if (!drag) return;
	drag = null;
	commit();
}

/**
 * Show how far the background removal is.
 * @param step The current step.
 */
function onStep(step: RemovalStep) {
	removing.value = step;
}

/**
 * Cut the product out of its background, as one undo step.
 * The cut-out is made once; undo and redo switch between the two photos.
 */
async function cutOut() {
	const source = props.source;
	if (!photo.value || removing.value) return;
	if (cut.value) return showCut();
	removing.value = { loading: true, percent: 0 };
	try {
		const img = await trim(await removeBackground(photo.value, onStep));
		if (props.source !== source) return;
		// keep a picture of the photo as it was, to wipe it away over the cut-out
		if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
			reveal.value = canvas.value?.toDataURL() ?? null;
		cut.value = img;
		showCut();
	} catch {
		toast.error(t("products.remove_bg_failed"));
	} finally {
		removing.value = null;
	}
}

/**
 * "Align center": move the image to the middle of the square. Zoom and padding stay. One undo step.
 */
function alignCenter() {
	apply({ x: 0, y: 0 });
}

/**
 * Show the cut-out, centred, a little smaller than the square so it can be moved at once.
 * One undo step: undo brings the photo back as it was.
 */
function showCut() {
	const next = { ...edit.value, cutout: true };
	apply({ cutout: true, x: 0, y: 0, zoom: fitZoom(next) * CUTOUT_START });
}

/**
 * Trim the cut-out to the product: drop the see-through rows and columns around it,
 * so zoom and move work on the product, not on the empty photo around it.
 * @param blob the cut-out PNG
 * @returns the trimmed image (the untrimmed one when nothing is left)
 */
async function trim(blob: Blob): Promise<HTMLImageElement> {
	const img = await loadImage(blob);
	const w = img.naturalWidth;
	const h = img.naturalHeight;
	const full = document.createElement("canvas");
	full.width = w;
	full.height = h;
	const ctx = full.getContext("2d", { willReadFrequently: true });
	if (!ctx) return img;
	ctx.drawImage(img, 0, 0);
	const alpha = ctx.getImageData(0, 0, w, h).data;
	let top = h;
	let left = w;
	let right = -1;
	let bottom = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if ((alpha[(y * w + x) * 4 + 3] ?? 0) < TRIM_ALPHA) continue;
			if (x < left) left = x;
			if (x > right) right = x;
			if (y < top) top = y;
			bottom = y;
		}
	}
	if (right < 0) return img;
	const out = document.createElement("canvas");
	out.width = right - left + 1;
	out.height = bottom - top + 1;
	out.getContext("2d")?.drawImage(full, -left, -top);
	const png = await new Promise<Blob | null>(function encode(resolve) {
		out.toBlob(resolve, "image/png");
	});
	return png ? loadImage(png) : img;
}

/** The words on the "Remove background" button: the model's progress while it gets ready. */
const removeLabel = computed(function removeLabel() {
	const step = removing.value;
	if (!step) return t("products.remove_bg");
	return step.loading
		? t("products.remove_bg_loading", { percent: step.percent })
		: t("products.remove_bg_working");
});

/**
 * Open a picture file as an image element.
 * @param blob The picture.
 * @returns The loaded image.
 */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
	return new Promise(function opened(resolve, reject) {
		const url = URL.createObjectURL(blob);
		const img = new Image();
		img.onload = function loaded() {
			URL.revokeObjectURL(url);
			resolve(img);
		};
		img.onerror = function failed() {
			URL.revokeObjectURL(url);
			reject(new Error("The picture could not be opened"));
		};
		img.src = url;
	});
}

/**
 * Nothing: a photo that won't open is shown as an error instead.
 * @returns null.
 */
function none() {
	return null;
}

/** Paint the full-size square and hand it back as a file. */
async function save() {
	const source = props.source;
	if (!source || saving.value) return;
	saving.value = true;
	const out = document.createElement("canvas");
	out.width = SIZE;
	out.height = SIZE;
	paint(out, SIZE);
	const blob = await new Promise<Blob | null>(function toBlob(resolve) {
		out.toBlob(resolve, "image/webp", 0.9);
	});
	saving.value = false;
	if (!blob) return;
	// a browser that can't write webp falls back to png
	const ext = blob.type.split("/")[1] ?? "png";
	const base = source instanceof File ? source.name : "image";
	const name = `${base.replace(/\.[^.]*$/, "")}.${ext}`;
	emit("save", new File([blob], name, { type: blob.type }));
}

/**
 * Close the dialog without saving when it is dismissed.
 * @param open the dialog's new open state
 */
function onOpen(open: boolean) {
	if (!open) emit("discard");
}

watch(
	() => props.source,
	async function load(source) {
		photo.value = null;
		cut.value = null;
		error.value = "";
		edit.value = { ...START };
		history.value = [{ ...START }];
		step.value = 0;
		if (!source) return;
		// the editor opened: get the "Remove background" model ready
		preloadBackgroundModel();
		const blob = await imageBlob(source);
		if (props.source !== source) return;
		if (!(blob instanceof Blob)) return void (error.value = blob.error);
		const img = await loadImage(blob).catch(none);
		if (props.source !== source) return;
		if (!img) return void (error.value = t("products.image_load_failed"));
		photo.value = img;
	},
	{ immediate: true },
);

watch([edit, image, canvas], draw, { flush: "post" });
</script>

<template>
  <Dialog :open="!!source" @update:open="onOpen">
    <DialogContent class="gap-4 sm:max-w-md md:max-w-2xl">
      <!-- the header stays on top while a short screen scrolls the rest, so Save is always in reach -->
      <DialogHeader>
        <div class="flex flex-wrap items-center gap-2">
          <DialogTitle class="mr-auto">{{ t("products.edit_image") }}</DialogTitle>
          <div class="flex">
            <Button type="button" variant="ghost" size="icon-sm" :disabled="step === 0" :aria-label="t('common.undo')" :title="t('common.undo')" @click="go(-1)">
              <Undo2 />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" :disabled="step >= history.length - 1" :aria-label="t('common.redo')" :title="t('common.redo')" @click="go(1)">
              <Redo2 />
            </Button>
          </div>
          <Button type="button" variant="outline" size="sm" @click="emit('discard')">{{ t("common.discard") }}</Button>
          <Button type="button" size="sm" :disabled="!image || saving" @click="save">
            <Loader2 v-if="saving" class="animate-spin" />
            {{ t("common.save") }}
          </Button>
        </div>
        <DialogDescription>{{ t("products.edit_image_hint") }}</DialogDescription>
      </DialogHeader>

      <!-- the preview on the left and the tools on the right; stacked on a phone. The preview never takes more than about half the screen's height -->
      <div class="grid gap-4 md:grid-cols-[min(22rem,55vh)_minmax(0,1fr)] md:items-start">
        <div class="relative">
          <canvas
            ref="canvas"
            :width="VIEW"
            :height="VIEW"
            class="block aspect-square w-full cursor-grab rounded-lg border touch-none bg-[repeating-conic-gradient(var(--color-muted)_0_25%,transparent_0_50%)] bg-size-[16px_16px] active:cursor-grabbing"
            :aria-label="t('products.image_preview')"
            role="img"
            @pointerdown="onDown"
            @pointermove="onMove"
            @pointerup="onUp"
            @pointercancel="onUp"
            @wheel.prevent="onWheel"
          />
          <p v-if="error" class="absolute inset-0 m-auto h-fit px-6 text-center text-sm text-destructive">{{ error }}</p>
          <Loader2 v-else-if="!image" class="absolute inset-0 m-auto size-6 animate-spin text-muted-foreground" />
          <!-- Remove background at work: a scan line under a shimmer, and the progress on the photo -->
          <div v-if="removing" class="pointer-events-none absolute inset-0 overflow-hidden rounded-lg" aria-hidden="true">
            <div class="magic-shimmer absolute inset-0" />
            <div class="magic-scan" />
            <span class="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-background/90 px-3 py-1 text-xs font-medium whitespace-nowrap shadow-sm">
              <Sparkles class="size-3.5 text-primary" /> {{ removeLabel }}
            </span>
          </div>
          <!-- done: the old photo is wiped away top to bottom, uncovering the cut-out -->
          <div v-if="reveal" class="pointer-events-none absolute inset-px overflow-hidden rounded-[calc(var(--radius-lg)-1px)]" aria-hidden="true">
            <img :src="reveal" alt="" class="magic-wipe size-full" @animationend="endReveal" />
            <div class="magic-wipe-line" />
          </div>
        </div>

        <div class="flex flex-col gap-4">
          <!-- side by side on a phone, one under the other in the narrow tools column -->
          <div class="grid grid-cols-[1fr_auto] gap-2 md:grid-cols-1">
            <Button type="button" variant="secondary" :disabled="!image || !!removing || edit.cutout" @click="cutOut">
              <Loader2 v-if="removing" class="animate-spin" />
              <Eraser v-else />
              {{ removeLabel }}
            </Button>
            <Button type="button" variant="secondary" :disabled="!image" @click="alignCenter">
              <Focus />
              {{ t("products.align_center") }}
            </Button>
          </div>

          <!-- one grid for all sliders: the label column is as wide as the longest label, so every bar starts at the same x -->
          <div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
            <label class="contents">
              {{ t("products.zoom") }}
              <input
                type="range"
                class="w-full accent-primary"
                :min="minZoom"
                :max="MAX_ZOOM"
                step="0.01"
                :value="edit.zoom"
                :disabled="!image"
                @input="onZoom"
                @change="commit"
              />
            </label>

            <label class="contents">
              {{ t("products.padding") }}
              <input
                type="range"
                class="w-full accent-primary"
                min="0"
                :max="MAX_PAD"
                step="0.01"
                :value="edit.pad"
                :disabled="!image"
                @input="onPad"
                @change="commit"
              />
            </label>

            <!-- only a cut-out gets a shadow: on a whole photo it would be a box behind the picture -->
            <label class="contents" :title="edit.cutout ? undefined : t('products.shadow_hint')">
              {{ t("products.shadow") }}
              <input
                type="range"
                class="w-full accent-primary"
                min="0"
                max="1"
                step="0.05"
                :value="edit.shadow"
                :disabled="!image || !edit.cutout"
                @input="onShadow"
                @change="commit"
              />
            </label>
          </div>

          <div class="space-y-1.5">
            <p class="text-xs text-muted-foreground">{{ t("products.background") }}</p>
            <div class="flex flex-wrap items-center gap-2">
              <button
                v-for="b in BACKGROUNDS"
                :key="b.color"
                type="button"
                class="size-7 rounded-full border border-black/15 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                :class="[edit.bg === b.color && 'ring-2 ring-primary ring-offset-2 ring-offset-background', !b.color && 'bg-[repeating-conic-gradient(var(--color-muted)_0_25%,transparent_0_50%)] bg-size-[8px_8px]']"
                :style="b.color ? { background: b.color } : undefined"
                :title="t(b.label)"
                :aria-label="t(b.label)"
                :aria-pressed="edit.bg === b.color"
                :disabled="!image"
                @click="apply({ bg: b.color })"
              />
              <!-- the colour picker: a rainbow ring with a + (or the picked colour), so it doesn't read as one more swatch -->
              <label
                class="relative grid size-7 place-items-center rounded-full bg-[conic-gradient(#ef4444,#eab308,#22c55e,#06b6d4,#3b82f6,#a855f7,#ef4444)] has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
                :class="[customBg && 'ring-2 ring-primary ring-offset-2 ring-offset-background', image ? 'cursor-pointer' : 'cursor-not-allowed opacity-50']"
                :title="t('products.bg_custom')"
              >
                <span class="grid size-5 place-items-center rounded-full bg-background" :style="customBg ? { background: edit.bg } : undefined">
                  <Plus v-if="!customBg" class="size-3.5" />
                </span>
                <input
                  type="color"
                  class="absolute inset-0 size-full cursor-[inherit] opacity-0"
                  :value="edit.bg || '#ffffff'"
                  :aria-label="t('products.bg_custom')"
                  :disabled="!image"
                  @input="onColor"
                  @change="commit"
                />
              </label>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <p class="text-xs text-muted-foreground">{{ t("products.flip") }}</p>
              <div class="grid grid-cols-2 gap-1">
                <Button type="button" variant="secondary" :disabled="!image" :aria-label="t('products.flip_horizontal')" :title="t('products.flip_horizontal')" @click="flipHorizontal">
                  <FlipHorizontal2 />
                </Button>
                <Button type="button" variant="secondary" :disabled="!image" :aria-label="t('products.flip_vertical')" :title="t('products.flip_vertical')" @click="flipVertical">
                  <FlipVertical2 />
                </Button>
              </div>
            </div>
            <div class="space-y-1.5">
              <p class="text-xs text-muted-foreground">{{ t("products.rotate") }}</p>
              <div class="grid grid-cols-2 gap-1">
                <Button type="button" variant="secondary" :disabled="!image" :aria-label="t('products.rotate_left')" :title="t('products.rotate_left')" @click="turn(-1)">
                  <RotateCcwSquare />
                </Button>
                <Button type="button" variant="secondary" :disabled="!image" :aria-label="t('products.rotate_right')" :title="t('products.rotate_right')" @click="turn(1)">
                  <RotateCwSquare />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
