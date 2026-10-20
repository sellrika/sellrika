<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import {
	Bold,
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
import WithTooltip from "./WithTooltip.vue";
import { t } from "@/lib/i18n";

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
 */
const props = defineProps<{
	modelValue: string;
	invalid?: boolean;
	/** The editor's accessible name; "Description" when not given. */
	label?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [string] }>();

const el = ref<HTMLDivElement>();
const block = ref("p");
const active = ref<Record<string, boolean>>({});
const inTable = ref(false);
const inSection = ref(false);
const sectionOpen = ref(false);

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
    />
  </div>
</template>
