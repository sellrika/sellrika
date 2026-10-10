import { expect, test } from "bun:test";
import { sanitizeHtml, stripTags } from "@helpers/html";

test("sanitizeHtml: strips scripts, handlers, bad URLs and comments; keeps builder markup", async () => {
	expect(
		await sanitizeHtml(
			`<section class="a" style="color:red"><h2 onclick="x()">Hi</h2><script>evil()</` +
				`script><p>ok</p></section>`,
		),
	).toBe(`<section class="a" style="color:red"><h2>Hi</h2><p>ok</p></section>`);
	// unknown tags unwrap, dangerous ones vanish with their content, comments go
	expect(
		await sanitizeHtml(
			`<body><p>hi</p></body><style>p{}</style><iframe src="https://x"></iframe><!-- c --><custom>kept text</custom>`,
		),
	).toBe(`<p>hi</p>kept text`);
	// safe links keep their href (plus rel), unsafe schemes are dropped
	expect(
		await sanitizeHtml(
			`<a href="https://x.io">x</a><a href="javascript:1">y</a><img src="/uploads/a.png" alt="a"><img src="//evil.io/x.png">`,
		),
	).toBe(
		`<a href="https://x.io" rel="noopener">x</a><a>y</a><img src="/uploads/a.png" alt="a"><img>`,
	);
});

test("sanitizeHtml: keeps what the description editor emits; stripTags flattens it", async () => {
	const html = `<h2>Title</h2><p><b>b</b><i>i</i><u>u</u><strike>s</strike></p><ul><li>one</li></ul><div style="margin-left: 40px;">in</div>`;
	expect(await sanitizeHtml(html)).toBe(html); // headings, marks, lists and the indent wrapper all survive
	const table = `<table><tbody><tr><th>Size</th><th>Price</th></tr><tr><td>S</td><td>3</td></tr></tbody></table>`;
	expect(await sanitizeHtml(table)).toBe(table); // tables survive whole — the editor builds them cell by cell
	const section = `<details open><summary>Storage</summary><p>Keep cool</p></details><details><summary>Use</summary><ul><li>daily</li></ul></details>`;
	expect(await sanitizeHtml(section)).toBe(section); // collapsible sections (the editor's Section tool), `open` included
	expect(
		stripTags(`<p>Fresh &amp; hot</p><ul><li>one</li><li>two</li></ul>`),
	).toBe("Fresh & hot one two");
});

test("sanitizeHtml: a raw-text tag goes with its inside, no handler gets out", async () => {
	const { RAW_TEXT_TAGS } = await import("@constants/Html.Constant");
	for (const tag of RAW_TEXT_TAGS) {
		const out = await sanitizeHtml(
			`<p>ok</p><${tag}><b onmouseover=x>m</b><script>evil()</` +
				`script></${tag}>`,
		);
		expect(out).not.toContain("onmouseover");
		expect(out).not.toContain("<script");
		expect(out).toStartWith("<p>ok</p>");
	}
});
