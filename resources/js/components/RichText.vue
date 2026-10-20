<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	ArrowDown,
	ArrowUp,
	Bold,
	ImagePlus,
	IndentDecrease,
	IndentIncrease,
	Italic,
	List,
	ListCollapse,
	ListOrdered,
	Strikethrough,
	Table,
	Underline,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import WithTooltip from "./WithTooltip.vue";
import { t } from "@/lib/i18n";
import { toast } from "vue-sonner";
import { uploadImage, type UploadFolder } from "@/lib/upload";

/**
 * Small rich-text editor for product descriptions.
 * ponytail: contenteditable + document.execCommand — deprecated, but every browser still
 * implements it and it covers headings/bold/italic/underline/strike/lists/indent with no
 * dependency. Output is sanitised server-side (app/helpers/html.ts) before it is stored, and
 * rendered with the shared `.rich-html` styles so the editor looks like the storefront.
 * Only the formatting commands are used — nothing touching the clipboard or designMode.
 * Tables are the exception: execCommand has no table commands, so the row/column operations
 * below are plain DOM edits on the cell the caret sits in.
 * Add a real editor (tiptap) only if merged cells or collaborative editing show up.
 * Pictures (prop `images`): a picked, pasted or dropped file is uploaded first and the text
 * keeps only its `/uploads/…` path. A picture pasted as base64 is taken out again: the text
 * never holds picture data, only a path of ours or an https link.
 */
const props = defineProps<{
	modelValue: string;
	invalid?: boolean;
	/** The editor's accessible name; "Description" when not given. */
	label?: string;
	/** The upload folder for pictures. Left out = the editor has no picture tool (an email body). */
	images?: UploadFolder;
}>();
const emit = defineEmits<{ "update:modelValue": [string] }>();

const el = ref<HTMLDivElement>();
/** The box around the text: the picked picture's frame and handles are drawn in it. */
const wrap = ref<HTMLDivElement>();
const block = ref("p");
const active = ref<Record<string, boolean>>({});
const inTable = ref(false);
const inSection = ref(false);
const sectionOpen = ref(false);
/** The picture the person clicked, for the picture tools. */
const picked = ref<HTMLImageElement | null>(null);
const pickedAlt = ref("");
const pickedCaption = ref(false);
/** The picked picture's width, in percent of the text's width. */
const pickedWidth = ref(100);
const pickedAlign = ref("");
/** Where the picked picture is drawn, in pixels from the top-left of `wrap`. */
const box = ref<{
	left: number;
	top: number;
	width: number;
	height: number;
} | null>(null);
/** The drag of a resize handle, while the mouse button is down. */
let drag: { x: number; width: number; side: number; full: number } | null =
	null;

const handles = [
	{ side: -1, class: "-top-1.5 -left-1.5 cursor-nwse-resize" },
	{ side: 1, class: "-top-1.5 -right-1.5 cursor-nesw-resize" },
	{ side: -1, class: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
	{ side: 1, class: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
] as const;

const aligns = [
	{ value: "left", icon: AlignLeft, label: "shared.image_align_left" },
	{ value: "center", icon: AlignCenter, label: "shared.image_align_center" },
	{ value: "right", icon: AlignRight, label: "shared.image_align_right" },
] as const;
const uploading = ref(false);

const marks = [
	{ cmd: "bold", icon: Bold, label: "shared.bold" },
	{ cmd: "italic", icon: Italic, label: "shared.italic" },
	{ cmd: "underline", icon: Underline, label: "shared.underline" },
	{ cmd: "strikeThrough", icon: Strikethrough, label: "shared.strikethrough" },
	{ cmd: "insertUnorderedList", icon: List, label: "shared.bullet_list" },
	{
		cmd: "insertOrderedList",
		icon: ListOrdered,
		label: "shared.numbered_list",
	},
] as const;

// Header row + one body row; the trailing paragraph is the way out — without it a table at the
// end of the document leaves nowhere to put the caret after it.
const TABLE = `<table><tbody><tr><th><br></th><th><br></th></tr><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>`;
// A collapsible section (native <details>, no script on the storefront): the summary is the title the
// reader clicks, `open` = shown unfolded by default. As with tables, a trailing paragraph is the way out.
function sectionHtml() {
	return `<details open><summary>${t("shared.section_title")}</summary><p><br></p></details>`;
}

/** `css` = emit inline styles instead of tags — only indent wants that (`<div style="margin-left">`
 *  reads as indentation; the tag form is `<blockquote>`, which is a quote, not an indent). */
function exec(cmd: string, value?: string, css = false) {
	el.value?.focus();
	document.execCommand("styleWithCSS", false, String(css));
	document.execCommand(cmd, false, value);
	sync();
}

function sync() {
	// picture data never stays in the text: a pasted base64 or blob picture goes
	for (const img of Array.from(el.value?.querySelectorAll("img") ?? []))
		if (/^(data|blob):/i.test(img.getAttribute("src") ?? ""))
			(img.closest("figure") ?? img).remove();
	// a picture dragged to another place leaves its empty frame behind
	for (const figure of Array.from(el.value?.querySelectorAll("figure") ?? []))
		if (!figure.querySelector("img")) figure.remove();
	emit("update:modelValue", el.value?.innerHTML ?? "");
	refresh();
}

/** Toolbar state for wherever the caret is now. */
function refresh() {
	for (const m of marks)
		active.value[m.cmd] = document.queryCommandState(m.cmd);
	block.value = (
		document.queryCommandValue("formatBlock") || "p"
	).toLowerCase();
	inTable.value = !!cell();
	const d = section();
	inSection.value = !!d;
	sectionOpen.value = !!d?.open;
	if (picked.value && !el.value?.contains(picked.value)) picked.value = null;
	place();
}

/**
 * Draw the frame and the handles over the picked picture.
 * Called after every change that can move the picture, and on scroll.
 */
function place() {
	const img = picked.value;
	if (!img || !wrap.value) {
		box.value = null;
		return;
	}
	const r = img.getBoundingClientRect();
	const w = wrap.value.getBoundingClientRect();
	box.value = {
		left: r.left - w.left,
		top: r.top - w.top,
		width: r.width,
		height: r.height,
	};
}

/**
 * Start to resize the picked picture with a corner handle.
 * @param e The pointer event on the handle.
 * @param side -1 for a left handle, 1 for a right handle.
 */
function startResize(e: PointerEvent, side: number) {
	const img = picked.value;
	if (!img?.parentElement) return;
	(e.target as Element).setPointerCapture(e.pointerId);
	drag = {
		x: e.clientX,
		width: img.getBoundingClientRect().width,
		side,
		full: img.parentElement.clientWidth,
	};
}

/**
 * Follow the mouse while a handle is dragged.
 * A picture in the middle grows on both sides, so it moves twice as fast.
 * @param e The pointer event.
 */
function resizing(e: PointerEvent) {
	if (!drag) return;
	const speed = pickedAlign.value === "center" ? 2 : 1;
	const px = drag.width + (e.clientX - drag.x) * drag.side * speed;
	pickedWidth.value = Math.round(
		Math.min(100, Math.max(10, (px / drag.full) * 100)),
	);
	setWidth();
}

/** Let the handle go. */
function stopResize() {
	drag = null;
}

/** A click on a picture picks it for the picture tools; a click elsewhere lets it go. */
function pick(e: MouseEvent) {
	const img = e.target instanceof HTMLImageElement ? e.target : null;
	picked.value = img;
	if (!img) return;
	pickedAlt.value = img.alt;
	pickedCaption.value = !!img.closest("figure")?.querySelector("figcaption");
	pickedWidth.value = Number.parseInt(img.style.width, 10) || 100;
	pickedAlign.value = img.closest("figure")?.style.textAlign ?? "";
	nextTick(place);
	const r = document.createRange();
	r.selectNode(img);
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(r);
}

/** The place of the caret, when it is inside the editor. */
function caretRange() {
	const sel = window.getSelection();
	if (!sel?.rangeCount || !el.value?.contains(sel.anchorNode)) return null;
	return sel.getRangeAt(0).cloneRange();
}

/** The place in the text under a point of the screen: where a dropped file lands. */
function rangeAt(x: number, y: number) {
	const d = document as Document & {
		caretPositionFromPoint?: (
			x: number,
			y: number,
		) => { offsetNode: Node; offset: number } | null;
	};
	if (d.caretRangeFromPoint) return d.caretRangeFromPoint(x, y);
	const at = d.caretPositionFromPoint?.(x, y);
	if (!at) return null;
	const r = document.createRange();
	r.setStart(at.offsetNode, at.offset);
	return r;
}

/** Does a piece of the text hold anything a reader sees? */
function hasContent(n: Element | DocumentFragment) {
	return !!n.textContent?.trim() || !!n.querySelector("img, table, details");
}

/** Mark the place a picture goes: right at the caret. A picture is a block of its own, so a paragraph
 *  (or heading) is split in two there; inside a list, a table or a section it goes after that whole block.
 *  The mark is taken out again once the pictures are in. */
function markPlace(at: Range | null) {
	const root = el.value!;
	const mark = document.createElement("span");
	if (!at || !root.contains(at.startContainer)) {
		root.append(mark);
		return mark;
	}
	if (at.startContainer === root) {
		root.insertBefore(mark, root.childNodes[at.startOffset] ?? null);
		return mark;
	}
	let block = (
		at.startContainer instanceof Element
			? at.startContainer
			: at.startContainer.parentElement
	) as Element;
	while (block.parentElement !== root) block = block.parentElement!;
	if (!/^(P|DIV|H[1-6]|BLOCKQUOTE)$/.test(block.tagName)) {
		block.after(mark);
		return mark;
	}
	const tail = document.createRange();
	tail.setStart(at.startContainer, at.startOffset);
	tail.setEnd(block, block.childNodes.length);
	const rest = tail.extractContents();
	block.after(mark);
	if (hasContent(rest)) {
		const next = block.cloneNode(false) as Element;
		next.append(rest);
		mark.after(next);
	}
	if (!hasContent(block)) block.remove();
	return mark;
}

/** Upload picture files and put each in the text as a figure, at the caret (or where `at` says). */
async function addImages(files: File[], at: Range | null = caretRange()) {
	const root = el.value;
	if (!root || !props.images || !files.length) return;
	const mark = markPlace(at);
	let last: Element | null = null;
	uploading.value = true;
	for (const one of files) {
		const r = await uploadImage(one, props.images);
		if ("error" in r) {
			toast.error(r.error);
			continue;
		}
		const figure = document.createElement("figure");
		const img = document.createElement("img");
		img.src = r.url;
		img.alt = "";
		figure.append(img);
		mark.before(figure);
		last = figure;
	}
	uploading.value = false;
	mark.remove();
	// the way out, as with tables: a picture at the end leaves nowhere to type
	if (last && !last.nextElementSibling)
		last.insertAdjacentHTML("afterend", "<p><br></p>");
	caretTo(last?.nextElementSibling);
	sync();
}

/** Open the file picker. The input is made on demand: a form never finds one more file input in the editor.
 *  The caret's place is kept from before the picker opens. */
function pickFiles() {
	const at = caretRange();
	const input = document.createElement("input");
	input.type = "file";
	input.accept = "image/*";
	input.multiple = true;
	input.onchange = () => addImages(Array.from(input.files ?? []), at);
	input.click();
}

/** The picture files of a paste or a drop. */
function imageFiles(list: FileList | undefined | null) {
	return Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
}

/** Text copied from another page brings that page's look with it: its colours, fonts, sizes and class names
 *  (pale text from a dark page is unreadable on a light store). Only what this editor itself writes stays:
 *  an indent, a picture's width and a picture's side. Picture data goes too. */
function plainLook(html: string) {
	const tpl = document.createElement("template");
	tpl.innerHTML = html;
	for (const e of Array.from(tpl.content.querySelectorAll<HTMLElement>("*"))) {
		if (/^(STYLE|SCRIPT|META|LINK|TITLE)$/.test(e.tagName)) {
			e.remove();
			continue;
		}
		const keep = {
			marginLeft: e.style.marginLeft,
			textAlign: e.tagName === "FIGURE" ? e.style.textAlign : "",
			width: e.tagName === "IMG" ? e.style.width : "",
			display: e.tagName === "IMG" ? e.style.display : "",
			marginRight: e.tagName === "IMG" ? e.style.marginRight : "",
		};
		for (const { name } of Array.from(e.attributes))
			if (!/^(href|src|alt|colspan|rowspan|open)$/.test(name))
				e.removeAttribute(name);
		for (const [prop, value] of Object.entries(keep))
			if (value) e.style[prop as keyof typeof keep] = value;
		if (
			e.tagName === "IMG" &&
			/^(data|blob):/i.test(e.getAttribute("src") ?? "")
		)
			e.remove();
	}
	return tpl.innerHTML;
}

/** A pasted picture file is uploaded, never kept as data in the text. Pasted text keeps its structure
 *  (headings, lists, links) and loses the look of the page it came from. */
function onPaste(e: ClipboardEvent) {
	const files = imageFiles(e.clipboardData?.files);
	if (props.images && files.length) {
		e.preventDefault();
		addImages(files);
		return;
	}
	const html = e.clipboardData?.getData("text/html");
	if (!html) return;
	e.preventDefault();
	exec("insertHTML", plainLook(html));
}

/** A dropped file lands where it was dropped, not where the caret was. */
function onDrop(e: DragEvent) {
	const files = imageFiles(e.dataTransfer?.files);
	if (!files.length) return;
	e.preventDefault();
	if (props.images) addImages(files, rangeAt(e.clientX, e.clientY));
}

/** The picked picture's frame; a picture with none gets one. */
function frameOf(img: HTMLImageElement) {
	let figure = img.closest("figure");
	if (!figure) {
		figure = document.createElement("figure");
		img.replaceWith(figure);
		figure.append(img);
	}
	return figure;
}

/** Make the picked picture narrower or wider: a share of the text's width. */
function setWidth() {
	if (!picked.value) return;
	picked.value.style.width =
		pickedWidth.value >= 100 ? "" : `${pickedWidth.value}%`;
	if (!picked.value.getAttribute("style"))
		picked.value.removeAttribute("style");
	sync();
}

/**
 * Put the picked picture at the left, the middle or the right.
 * The picture is a block (Tailwind and the store themes say so), and a block
 * does not follow `text-align`. So the picture is moved with its margins.
 * The frame keeps `text-align` too: the caption follows it.
 * @param value "left", "center" or "right".
 */
function setAlign(value: string) {
	const img = picked.value;
	if (!img) return;
	frameOf(img).style.textAlign = value;
	img.style.display = "block";
	img.style.marginLeft = value === "left" ? "" : "auto";
	img.style.marginRight = value === "center" ? "auto" : "";
	pickedAlign.value = value;
	sync();
}

/** Move the picked picture over the block before it, or under the block after it. */
function moveImage(by: -1 | 1) {
	const root = el.value;
	let block: Element | null = picked.value;
	while (block && block.parentElement !== root) block = block.parentElement;
	// the first line of a text may be bare text with no paragraph around it: it counts as a block too
	let other = by < 0 ? block?.previousSibling : block?.nextSibling;
	while (
		other &&
		other.nodeType === Node.TEXT_NODE &&
		!other.textContent?.trim()
	)
		other = by < 0 ? other.previousSibling : other.nextSibling;
	if (!block || !other) return;
	if (by < 0) other.before(block);
	else other.after(block);
	picked.value?.scrollIntoView({ block: "nearest" });
	sync();
}

function setAlt() {
	if (!picked.value) return;
	picked.value.alt = pickedAlt.value;
	sync();
}

/** A line of text under the picture, or none. */
function toggleCaption() {
	const img = picked.value;
	if (!img) return;
	const figure = frameOf(img);
	const caption = figure.querySelector("figcaption");
	if (caption) caption.remove();
	else {
		const c = document.createElement("figcaption");
		c.textContent = t("shared.image_caption");
		figure.append(c);
		selectAll(c);
	}
	pickedCaption.value = !caption;
	sync();
}

function delImage() {
	const img = picked.value;
	if (!img) return;
	(img.closest("figure") ?? img).remove();
	picked.value = null;
	sync();
}

/** The table cell the caret is in, if it is in one of ours. */
function cell() {
	const n = window.getSelection()?.anchorNode ?? null;
	const c = (n instanceof Element ? n : (n?.parentElement ?? null))?.closest(
		"td, th",
	);
	return c && el.value?.contains(c) ? (c as HTMLTableCellElement) : null;
}

/** The section the caret is in, if it is one of ours. */
function section() {
	const n = window.getSelection()?.anchorNode ?? null;
	const d = (n instanceof Element ? n : (n?.parentElement ?? null))?.closest(
		"details",
	);
	return d && el.value?.contains(d) ? (d as HTMLDetailsElement) : null;
}

const blank = (tag: string) => `<${tag}><br></${tag}>`;

/** Park the caret in `c` — a delete takes the cell the caret was in with it, and without this the
 *  table tools would blink out after every Row −/Column −. */
function caretTo(c: Element | null | undefined) {
	if (!c) return;
	const r = document.createRange();
	r.selectNodeContents(c);
	r.collapse(true);
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(r);
}

/** Tables are block-level: drop one after the block the caret is in, never at the caret itself —
 *  execCommand("insertHTML") would split that block and leave, say, an empty bullet behind.
 *  ponytail: like the row/column edits below this is a plain DOM write, so it is outside the
 *  browser's native undo stack; a real editor (tiptap) is the upgrade if undo matters. */
function insertTable() {
	const root = el.value;
	if (!root) return;
	root.focus();
	const tpl = document.createElement("template");
	tpl.innerHTML = TABLE;
	const table = tpl.content.querySelector("table")!;
	const n = window.getSelection()?.anchorNode ?? null;
	let e = (
		n instanceof Element ? n : (n?.parentElement ?? null)
	) as Element | null;
	while (e && e.parentElement !== root) e = e.parentElement; // climb to the editor's own child
	if (e) e.after(tpl.content);
	else root.append(tpl.content);
	caretTo(table.querySelector("th"));
	sync();
}

/** Select a whole element's text — the new section's title, so typing replaces it. */
function selectAll(c: Element | null | undefined) {
	if (!c) return;
	const r = document.createRange();
	r.selectNodeContents(c);
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(r);
}

/** Same rule as tables: a section goes after the block the caret is in (or after the section it is in). */
function insertSection() {
	const root = el.value;
	if (!root) return;
	root.focus();
	const tpl = document.createElement("template");
	tpl.innerHTML = `${sectionHtml()}<p><br></p>`;
	const details = tpl.content.querySelector("details")!;
	const n = window.getSelection()?.anchorNode ?? null;
	let e = (
		n instanceof Element ? n : (n?.parentElement ?? null)
	) as Element | null;
	while (e && e.parentElement !== root) e = e.parentElement;
	if (e) e.after(tpl.content);
	else root.append(tpl.content);
	selectAll(details.querySelector("summary"));
	sync();
}

function addSection() {
	const d = section();
	if (!d) return;
	d.insertAdjacentHTML("afterend", sectionHtml());
	selectAll(d.nextElementSibling?.querySelector("summary"));
	sync();
}

/** Unfolded by default on the storefront, or folded — what the editor shows is what is saved. */
function toggleSection() {
	const d = section();
	if (!d) return;
	d.open = !d.open;
	sync();
}

function delSection() {
	section()?.remove();
	sync();
}

function addRow() {
	const tr = cell()?.closest("tr");
	if (!tr) return;
	tr.insertAdjacentHTML(
		"afterend",
		`<tr>${blank("td").repeat(tr.cells.length)}</tr>`,
	);
	sync();
}

function addCol() {
	const c = cell();
	if (!c) return;
	// append after the same index in every row, keeping each row's own cell type (th in the header)
	for (const tr of Array.from(c.closest("table")!.rows)) {
		const ref = tr.cells[c.cellIndex] ?? tr.cells[tr.cells.length - 1];
		ref?.insertAdjacentHTML("afterend", blank(ref.tagName.toLowerCase()));
	}
	sync();
}

function delRow() {
	const c = cell();
	if (!c) return;
	const table = c.closest("table")!;
	const tr = c.closest("tr")!;
	const next = (tr.nextElementSibling ??
		tr.previousElementSibling) as HTMLTableRowElement | null;
	tr.remove();
	if (!table.rows.length)
		table.remove(); // last row out → the table goes too
	else caretTo(next?.cells[c.cellIndex] ?? next?.cells[0]);
	sync();
}

function delCol() {
	const c = cell();
	if (!c) return;
	const table = c.closest("table")!;
	const keep = (c.nextElementSibling ??
		c.previousElementSibling) as HTMLTableCellElement | null;
	for (const tr of Array.from(table.rows)) tr.cells[c.cellIndex]?.remove();
	for (const tr of Array.from(table.rows)) if (!tr.cells.length) tr.remove();
	if (!table.rows.length) table.remove();
	else caretTo(keep);
	sync();
}

function delTable() {
	cell()?.closest("table")?.remove();
	sync();
}

// One-way fill: the editor owns its DOM while mounted (rewriting innerHTML on every keystroke would fight the
// caret), so it is seeded from the form once — and again only when the value changes from outside (an extension's
// `set({ description })`, a reset): a keystroke emits the editor's own HTML, so that round trip is a no-op here.
const fill = () => {
	if (!el.value || el.value.innerHTML === props.modelValue) return;
	el.value.innerHTML = props.modelValue;
	// A table or section at the very start/end (an extension's leaflet, a saved product) leaves the caret nowhere to
	// go above/below it — the same trailing-paragraph rule the insert tools follow, applied to content from outside.
	const boxed = (n: Element | null) =>
		!!n && /^(DETAILS|TABLE)$/.test(n.tagName);
	if (boxed(el.value.firstElementChild))
		el.value.insertAdjacentHTML("afterbegin", "<p><br></p>");
	if (boxed(el.value.lastElementChild))
		el.value.insertAdjacentHTML("beforeend", "<p><br></p>");
};
onMounted(fill);
watch(() => props.modelValue, fill);

/** A picture that changes size (a drag, a slow load) moves its frame too. */
const sizes = new ResizeObserver(place);
watch(picked, watchPicked);

/**
 * Watch the size of the newly picked picture.
 * @param img The picked picture, or null.
 */
function watchPicked(img: HTMLImageElement | null) {
	sizes.disconnect();
	if (img) sizes.observe(img);
	place();
}
onMounted(addResizeListener);
onBeforeUnmount(removeListeners);

/** Keep the frame on the picture when the window changes size. */
function addResizeListener() {
	window.addEventListener("resize", place);
}

/** Stop all listeners of the picture frame. */
function removeListeners() {
	sizes.disconnect();
	window.removeEventListener("resize", place);
}
</script>

<template>
  <div class="overflow-hidden rounded-md border shadow-xs" :class="invalid && 'border-destructive'">
    <div class="flex flex-wrap items-center gap-1 border-b bg-muted/40 p-1">
      <select
        :value="block"
        class="h-8 rounded-sm border-none bg-transparent px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        :aria-label="t('shared.text_style')"
        @change="exec('formatBlock', ($event.target as HTMLSelectElement).value)"
      >
        <option value="p">{{ t("shared.normal_text") }}</option>
        <option value="h1">{{ t("shared.heading1") }}</option>
        <option value="h2">{{ t("shared.heading2") }}</option>
        <option value="h3">{{ t("shared.heading3") }}</option>
      </select>
      <span class="mx-0.5 h-5 w-px bg-border" />
      <WithTooltip v-for="m in marks" :key="m.cmd" :label="t(m.label)">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          class="size-8"
          :class="active[m.cmd] && 'bg-accent text-accent-foreground'"
          :aria-label="t(m.label)"
          :aria-pressed="!!active[m.cmd]"
          @mousedown.prevent
          @click="exec(m.cmd)"
        >
          <component :is="m.icon" />
        </Button>
      </WithTooltip>
      <span class="mx-0.5 h-5 w-px bg-border" />
      <WithTooltip :label="t('shared.decrease_indent')"><Button type="button" variant="ghost" size="icon" class="size-8" :aria-label="t('shared.decrease_indent')" @mousedown.prevent @click="exec('outdent', undefined, true)"><IndentDecrease /></Button></WithTooltip>
      <WithTooltip :label="t('shared.increase_indent')"><Button type="button" variant="ghost" size="icon" class="size-8" :aria-label="t('shared.increase_indent')" @mousedown.prevent @click="exec('indent', undefined, true)"><IndentIncrease /></Button></WithTooltip>
      <span class="mx-0.5 h-5 w-px bg-border" />
      <WithTooltip :label="t('shared.insert_table')"><Button type="button" variant="ghost" size="icon" class="size-8" :aria-label="t('shared.insert_table')" @mousedown.prevent @click="insertTable"><Table /></Button></WithTooltip>
      <WithTooltip :label="t('shared.insert_section_title')"><Button type="button" variant="ghost" size="icon" class="size-8" :aria-label="t('shared.insert_section')" @mousedown.prevent @click="insertSection"><ListCollapse /></Button></WithTooltip>
      <template v-if="images">
        <WithTooltip :label="t('shared.insert_image')"><span class="inline-flex"><Button type="button" variant="ghost" size="icon" class="size-8" :disabled="uploading" :aria-label="t('shared.insert_image')" @mousedown.prevent @click="pickFiles"><ImagePlus /></Button></span></WithTooltip>
      </template>
    </div>

    <!-- Picture tools: only while a picture is picked. -->
    <div v-if="picked" class="flex flex-wrap items-center gap-1 border-b bg-muted/20 px-1 py-1 text-xs">
      <span class="px-1.5 text-muted-foreground">{{ t("shared.image") }}</span>
      <Input v-model="pickedAlt" class="h-7 w-56 text-xs" :placeholder="t('shared.image_alt')" :aria-label="t('shared.image_alt')" @input="setAlt" />
      <WithTooltip v-for="a in aligns" :key="a.value" :label="t(a.label)"><Button type="button" variant="ghost" size="icon" class="size-7" :class="pickedAlign === a.value && 'bg-accent text-accent-foreground'" :aria-label="t(a.label)" :aria-pressed="pickedAlign === a.value" @mousedown.prevent @click="setAlign(a.value)"><component :is="a.icon" /></Button></WithTooltip>
      <WithTooltip :label="t('shared.image_move_up')"><Button type="button" variant="ghost" size="icon" class="size-7" :aria-label="t('shared.image_move_up')" @mousedown.prevent @click="moveImage(-1)"><ArrowUp /></Button></WithTooltip>
      <WithTooltip :label="t('shared.image_move_down')"><Button type="button" variant="ghost" size="icon" class="size-7" :aria-label="t('shared.image_move_down')" @mousedown.prevent @click="moveImage(1)"><ArrowDown /></Button></WithTooltip>
      <Button type="button" variant="ghost" size="sm" class="h-7 px-2 text-xs" @mousedown.prevent @click="toggleCaption">{{ pickedCaption ? t("shared.image_caption_remove") : t("shared.image_caption_add") }}</Button>
      <Button type="button" variant="ghost" size="sm" class="h-7 px-2 text-xs text-destructive" @mousedown.prevent @click="delImage">{{ t("shared.delete_image") }}</Button>
    </div>

    <!-- Section tools: only while the caret is in a collapsible section. -->
    <div v-if="inSection" class="flex flex-wrap items-center gap-1 border-b bg-muted/20 px-1 py-1 text-xs">
      <span class="px-1.5 text-muted-foreground">{{ t("shared.section") }}</span>
      <Button type="button" variant="ghost" size="sm" class="h-7 px-2 text-xs" @mousedown.prevent @click="addSection">{{ t("shared.section_add") }}</Button>
      <Button type="button" variant="ghost" size="sm" class="h-7 px-2 text-xs" @mousedown.prevent @click="toggleSection">{{ sectionOpen ? t("shared.open_by_default_on") : t("shared.open_by_default") }}</Button>
      <Button type="button" variant="ghost" size="sm" class="h-7 px-2 text-xs text-destructive" @mousedown.prevent @click="delSection">{{ t("shared.delete_section") }}</Button>
    </div>
    <!-- Table row/column tools: only while the caret is in a cell, so they never sit there dead. -->
    <div v-if="inTable" class="flex flex-wrap items-center gap-1 border-b bg-muted/20 px-1 py-1 text-xs">
      <span class="px-1.5 text-muted-foreground">{{ t("shared.table") }}</span>
      <Button type="button" variant="ghost" size="sm" class="h-7 px-2 text-xs" @mousedown.prevent @click="addRow">{{ t("shared.row_add") }}</Button>
      <Button type="button" variant="ghost" size="sm" class="h-7 px-2 text-xs" @mousedown.prevent @click="delRow">{{ t("shared.row_del") }}</Button>
      <Button type="button" variant="ghost" size="sm" class="h-7 px-2 text-xs" @mousedown.prevent @click="addCol">{{ t("shared.col_add") }}</Button>
      <Button type="button" variant="ghost" size="sm" class="h-7 px-2 text-xs" @mousedown.prevent @click="delCol">{{ t("shared.col_del") }}</Button>
      <Button type="button" variant="ghost" size="sm" class="h-7 px-2 text-xs text-destructive" @mousedown.prevent @click="delTable">{{ t("shared.delete_table") }}</Button>
    </div>

    <div ref="wrap" class="relative overflow-hidden">
    <div
      ref="el"
      contenteditable
      role="textbox"
      aria-multiline="true"
      :aria-label="label ?? t('shared.description')"
      data-slot="description-editor"
      class="rich-html min-h-48 resize-y overflow-y-auto bg-transparent px-3 py-2 text-sm outline-none"
      @input="sync"
      @keyup="refresh"
      @mouseup="refresh"
      @focus="refresh"
      @click="pick"
      @paste="onPaste"
      @drop="onDrop"
      @scroll="place"
    />
    <!-- The picked picture's frame, with a resize handle at each corner. -->
    <div
      v-if="box"
      class="pointer-events-none absolute rounded-sm outline-2 outline-primary"
      :style="{ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }"
    >
      <span
        v-for="(h, i) in handles"
        :key="i"
        data-slot="image-resize"
        class="pointer-events-auto absolute size-3 touch-none rounded-full border-2 border-background bg-primary"
        :class="h.class"
        @pointerdown.prevent="startResize($event, h.side)"
        @pointermove="resizing"
        @pointerup="stopResize"
        @pointercancel="stopResize"
      />
    </div>
    </div>
  </div>
</template>
