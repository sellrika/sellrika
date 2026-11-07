import { expect, test } from "bun:test";
import { languageOf, paintCode } from "../codeBlock";

test("paintCode: colours are inline, with no highlight.js class left", () => {
	const html = paintCode("const a = 1;", "typescript");
	expect(html).toContain(
		'<span style="color:var(--code-keyword,#ff7b72)">const</span>',
	);
	expect(html).not.toContain("hljs");
	expect(html.endsWith("\n")).toBe(true);
});

test("paintCode: code text is escaped, never turned into tags", () => {
	const html = paintCode("<script>alert(1)</script>", "plaintext");
	expect(html).toBe("&lt;script&gt;alert(1)&lt;/script&gt;\n");
});

test("paintCode: an empty block keeps one line for the caret", () => {
	expect(paintCode("", "python")).toBe("\n");
	expect(paintCode("x\n", "python")).toBe("x\n");
});

test("languageOf: a known language, or plain text", () => {
	expect(languageOf("language-python")).toBe("python");
	expect(languageOf("language-cobol")).toBe("plaintext");
	expect(languageOf("")).toBe("plaintext");
});
