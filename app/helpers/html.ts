/**
 * Allowlist HTML sanitiser for merchant-written HTML.
 * That is store pages (GrapesJS output) and product descriptions
 * (the rich-text editor).
 * It is built on Bun's native HTMLRewriter.
 * Runs on save. That is the trust boundary:
 * the stored HTML is rendered with v-html on the public storefront.
 * Tags cover what those editors emit.
 * Scripts / iframes and inline event handlers never survive.
 * The page CSS is stored separately and rendered as textContent.
 * CSS can't execute code, so it isn't filtered.
 */

import {
	ALLOWED_TAGS,
	DROPPED_TAGS,
	HTML_ENTITIES,
	SANITIZE_PASSES,
} from "@constants/Html.Constant";
import { CODE_STYLE, languageOf, PRE_STYLE, paintCode } from "@/lib/codeBlock";

/**
 * A code block: `<pre><code …>text</code></pre>`.
 * Group 1 is the `<code>`'s attributes, group 2 its content.
 */
const CODE_BLOCK =
	/<pre\b[^>]*>\s*<code\b([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi;

/**
 * Colour one plain code block, the same way the editor does.
 * A block that already holds tags (the editor's coloured spans) stays as it is.
 * @param block The whole `<pre>…</pre>`.
 * @param attrs The `<code>`'s attributes.
 * @param inner The `<code>`'s content.
 * @returns The coloured block, or the block unchanged.
 */
function paintBlock(block: string, attrs: string, inner: string): string {
	if (inner.includes("<")) return block;
	const cls = /\bclass\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? "";
	const language = languageOf(cls);
	const text = inner.replace(/&(nbsp|amp|lt|gt|quot|#39|#x27);/g, decodeEntity);
	return `<pre style="${PRE_STYLE}"><code class="language-${language}" style="${CODE_STYLE}">${paintCode(text, language)}</code></pre>`;
}

/**
 * One HTML entity back to its letter.
 * @param _ The whole entity (not used).
 * @param name The entity's name, like `lt`.
 * @returns The letter.
 */
function decodeEntity(_: string, name: string): string {
	// highlight.js writes a ' as &#x27;
	return name === "#x27" ? "'" : (HTML_ENTITIES[name] ?? name);
}

/**
 * Colour every plain code block, so HTML from the API, the MCP server
 * or an AI assistant looks like a code block made in the editor.
 * ponytail: plain-text blocks only know the named entities of `HTML_ENTITIES`;
 * a numeric one (`&#123;`) stays as typed.
 * @param html The HTML.
 * @returns The HTML with its code blocks coloured.
 */
export function paintCodeBlocks(html: string): string {
	return html.replace(CODE_BLOCK, paintBlock);
}

/**
 * Is this link safe to keep in an `href` or `src`?
 * @param v The attribute value.
 * @returns True for http(s), mailto, tel, a path on this site or a `#` anchor.
 */
function safeUrl(v: string) {
	return /^(https?:|mailto:|tel:|\/(?!\/)|#)/i.test(v.trim());
}

/**
 * Clean merchant-written HTML before it is saved.
 * The cleaner runs again on its own output until nothing changes,
 * so markup that only shows up after an unwrap is cleaned too.
 * @param html The HTML from the editor.
 * @returns The HTML with only allowed tags, attributes and links.
 *   "" when it never stops changing.
 */
export async function sanitizeHtml(html: string): Promise<string> {
	let out = paintCodeBlocks(html);
	for (let pass = 0; pass < SANITIZE_PASSES; pass++) {
		const next = await cleanOnce(out);
		if (next === out) return out;
		out = next;
	}
	return "";
}

/**
 * One run of the cleaner.
 * Dropped tags go with their content. Other unknown tags keep their content.
 * @param html The HTML to clean.
 * @returns The HTML with only allowed tags, attributes and links.
 */
async function cleanOnce(html: string): Promise<string> {
	return await new HTMLRewriter()
		.on("*", {
			element(el) {
				const tag = el.tagName.toLowerCase();
				if (DROPPED_TAGS.has(tag)) return void el.remove();
				if (!ALLOWED_TAGS.has(tag)) return void el.removeAndKeepContent();
				// keep the builder's class/id/style/data-* attributes
				// drop event handlers and bad URLs
				for (const [name] of [...el.attributes])
					if (name.startsWith("on")) el.removeAttribute(name);
				for (const attr of ["href", "src"]) {
					const v = el.getAttribute(attr);
					if (v !== null && !safeUrl(v)) el.removeAttribute(attr);
				}
				if (tag === "a" && el.getAttribute("href"))
					el.setAttribute("rel", "noopener");
			},
		})
		.onDocument({ comments: (c) => void c.remove() })
		.transform(new Response(html))
		.text();
}

/**
 * HTML → plain text.
 * For places that can't render markup (JSON-LD, meta tags, CSV previews).
 * @param html The HTML.
 * @returns The text, with single spaces and no tags.
 */
export function stripTags(html: string) {
	return html
		.replace(/<[^>]*>/g, " ")
		.replace(
			/&(nbsp|amp|lt|gt|quot|#39);/g,
			(_, e: string) => HTML_ENTITIES[e] ?? e,
		)
		.replace(/\s+/g, " ")
		.trim();
}
