import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * The languages a code block can be coloured as.
 * `id` goes in the `language-<id>` class of the `<code>`.
 * "plaintext" means no colours.
 */
export const CODE_LANGUAGES = [
	{ id: "plaintext", name: "" },
	{ id: "bash", name: "Bash" },
	{ id: "c", name: "C / C++" },
	{ id: "csharp", name: "C#" },
	{ id: "css", name: "CSS" },
	{ id: "go", name: "Go" },
	{ id: "html", name: "HTML" },
	{ id: "java", name: "Java" },
	{ id: "javascript", name: "JavaScript" },
	{ id: "json", name: "JSON" },
	{ id: "php", name: "PHP" },
	{ id: "python", name: "Python" },
	{ id: "ruby", name: "Ruby" },
	{ id: "rust", name: "Rust" },
	{ id: "sql", name: "SQL" },
	{ id: "typescript", name: "TypeScript" },
	{ id: "yaml", name: "YAML" },
] as const;

const GRAMMARS = {
	bash,
	c: cpp,
	csharp,
	css,
	go,
	html: xml,
	java,
	javascript,
	json,
	php,
	plaintext,
	python,
	ruby,
	rust,
	sql,
	typescript,
	yaml,
};
for (const [id, grammar] of Object.entries(GRAMMARS))
	hljs.registerLanguage(id, grammar);

/**
 * The default colour of each kind of word (a GitHub dark look).
 * A page can change one with its CSS variable `--code-<kind>`,
 * for example `--code-keyword`, to fit its own background.
 */
const TOKEN_COLORS = {
	keyword: "#ff7b72",
	type: "#ffa657",
	title: "#d2a8ff",
	string: "#a5d6ff",
	number: "#79c0ff",
	tag: "#7ee787",
	comment: "#8b949e",
	addition: "#aff5b4",
	deletion: "#ffdcd7",
} as const;

/** Which kind of word each highlight.js scope is. */
const SCOPE_TOKENS: Record<string, keyof typeof TOKEN_COLORS> = {
	keyword: "keyword",
	"selector-tag": "keyword",
	"template-tag": "keyword",
	doctag: "keyword",
	type: "type",
	built_in: "type",
	variable: "type",
	"template-variable": "type",
	bullet: "type",
	title: "title",
	string: "string",
	regexp: "string",
	meta: "number",
	number: "number",
	literal: "number",
	attr: "number",
	attribute: "number",
	property: "number",
	symbol: "number",
	operator: "number",
	"selector-id": "number",
	"selector-class": "number",
	"selector-attr": "number",
	"selector-pseudo": "number",
	tag: "tag",
	name: "tag",
	section: "tag",
	addition: "addition",
	deletion: "deletion",
	comment: "comment",
	quote: "comment",
};

/**
 * The look of the whole block, written on the `<pre>`.
 * The colours are inline, so a page with no style sheet for them
 * (an email, an extension's page) still shows them.
 * A page may set `--code-bg` and `--code-text` to change them.
 */
export const PRE_STYLE =
	"background:var(--code-bg,#0d1117);color:var(--code-text,#e6edf3);padding:12px 16px;border-radius:8px;overflow-x:auto;white-space:pre;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;tab-size:4";

/** The `<code>` inside: a theme's own `code` box must not show inside ours. */
export const CODE_STYLE =
	"background:none;padding:0;color:inherit;font:inherit";

/**
 * The language of a code block.
 * @param className The `<code>` element's class list, as a string.
 * @returns A known language id, or "plaintext".
 */
export function languageOf(className: string): string {
	const id = /\blanguage-([\w-]+)/.exec(className)?.[1] ?? "plaintext";
	return id in GRAMMARS ? id : "plaintext";
}

/**
 * Turn one highlight.js `class` into an inline colour.
 * @param _ The whole match (not used).
 * @param classes The span's classes, like `hljs-title function_`.
 * @returns The opening tag with a `style`, or a bare `<span>`.
 */
function styleSpan(_: string, classes: string): string {
	const scope = /hljs-([\w-]+)/.exec(classes)?.[1] ?? "";
	const token = SCOPE_TOKENS[scope];
	if (!token) return "<span>";
	const color = `var(--code-${token},${TOKEN_COLORS[token]})`;
	const italic = token === "comment" ? ";font-style:italic" : "";
	return `<span style="color:${color}${italic}">`;
}

/**
 * Colour code as HTML.
 * The text is escaped by highlight.js, so it never turns into tags.
 * The result always ends with a new line. A `<pre>` hides its last one,
 * so this keeps an empty last line on screen and gives the caret a place.
 * @param text The plain code.
 * @param language A language id from `CODE_LANGUAGES`.
 * @returns The HTML for inside the `<code>`.
 */
export function paintCode(text: string, language: string): string {
	const shown = text.endsWith("\n") ? text : `${text}\n`;
	const id = languageOf(`language-${language}`);
	const html = hljs.highlight(shown, { language: id, ignoreIllegals: true });
	return html.value.replace(/<span class="([^"]*)">/g, styleSpan);
}
