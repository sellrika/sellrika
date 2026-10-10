/**
 * Allowlists for the HTML sanitiser (`app/helpers/html.ts`).
 * The tags cover what the page builder (GrapesJS)
 * and the rich-text editor emit.
 * Anything else is unwrapped or dropped.
 */

/**
 * Tags that survive sanitising.
 * Everything else keeps its content but loses the tag.
 */
export const ALLOWED_TAGS = new Set([
	"p",
	"br",
	"hr",
	"b",
	"strong",
	"i",
	"em",
	"u",
	"s",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"li",
	"a",
	"img",
	"blockquote",
	"div",
	"span",
	"section",
	"header",
	"footer",
	"main",
	"article",
	"aside",
	"nav",
	"figure",
	"figcaption",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"td",
	"th",
	"small",
	"sup",
	"sub",
	"mark",
	"code",
	"pre",
	"strike",
	"del",
	"ins",
	"details",
	"summary",
]);

/**
 * Tags whose inside the parser reads as text, not as tags.
 * The cleaner never sees the markup inside them,
 * so unwrapping one would let that markup out as live HTML.
 */
export const RAW_TEXT_TAGS = [
	"xmp",
	"textarea",
	"title",
	"noembed",
	"noframes",
	"plaintext",
];

/**
 * Tags whose *content* must go too.
 * A stripped `<script>` must not leave its code behind as text.
 */
export const DROPPED_TAGS = new Set([
	...RAW_TEXT_TAGS,
	"script",
	"style",
	"iframe",
	"object",
	"embed",
	"form",
	"svg",
	"math",
	"link",
	"meta",
	"head",
	"template",
	"noscript",
]);

/**
 * How many times the cleaner may run on its own output.
 * Clean HTML stops changing on the second run.
 */
export const SANITIZE_PASSES = 5;

/**
 * The handful of entities `stripTags` decodes
 * when turning markup into plain text.
 */
export const HTML_ENTITIES: Record<string, string> = {
	nbsp: " ",
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	"#39": "'",
};
